#include "BluetoothSerial.h"
#include <Wire.h>
#include <MPU6050.h>

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error Bluetooth is not enabled!
#endif

// ================= CONFIG =================
// Assumes: sensor X axis points along the forearm toward the fingers,
// Z up when palm is down. Roll (about X) = supination/pronation.
// If your mounting differs, remap axes in readImu().
#define STEER_SIGN     1.0f   // flip to -1 if supination gives negative steer
#define MOVE_SIGN      1.0f   // flip if "left" comes out as positive
#define MOVE_X_SOURCE  0      // Game 2 source: 0 = yaw (true left/right sweep, drifts slowly)
                              //                1 = pitch (tilt, drift-free)
                              //                2 = roll  (tilt, drift-free)

const float DEADBAND_DEG     = 2.0f;   // ignore tremor/noise around neutral
const float DEFAULT_ROLL_ROM = 45.0f;  // default +/- range mapped to full steering
const float DEFAULT_MOVE_ROM = 30.0f;  // default +/- range mapped to full left/right
const float OUT_ALPHA        = 0.15f;  // output smoothing (lower = smoother, laggier)
const float KP               = 1.0f;   // Mahony gain: accel correction strength
const float ACC_TRUST_G      = 0.15f;  // ignore accel when |a| differs from 1g by more than this
const float STILL_DPS        = 1.0f;   // gyro below this = "stationary" for bias tracking
const float BIAS_ALPHA       = 0.002f; // online gyro bias adaptation rate

const uint32_t IMU_DT_US     = 5000;   // 200 Hz filter update
const uint32_t OUT_PERIOD_MS = 20;     // 50 Hz output

// ================= STATE =================
BluetoothSerial SerialBT;
MPU6050 mpu;

float q0 = 1, q1 = 0, q2 = 0, q3 = 0;          // current orientation
float z0 = 1, z1 = 0, z2 = 0, z3 = 0;          // neutral-pose quaternion
float gyroBias[3] = {0, 0, 0};                 // deg/s
uint16_t stillCount = 0;

float rollRomPos = DEFAULT_ROLL_ROM, rollRomNeg = DEFAULT_ROLL_ROM;
float moveRomPos = DEFAULT_MOVE_ROM, moveRomNeg = DEFAULT_MOVE_ROM;

float rollRel = 0, pitchRel = 0, yawRel = 0;   // degrees, relative to neutral
float steerSm = 0, moveSm = 0;

// ================= HELPERS =================
static float wrap180(float a) {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

static void quatMul(float a0, float a1, float a2, float a3,
                    float b0, float b1, float b2, float b3,
                    float &r0, float &r1, float &r2, float &r3) {
  r0 = a0*b0 - a1*b1 - a2*b2 - a3*b3;
  r1 = a0*b1 + a1*b0 + a2*b3 - a3*b2;
  r2 = a0*b2 - a1*b3 + a2*b0 + a3*b1;
  r3 = a0*b3 + a1*b2 - a2*b1 + a3*b0;
}

static void readImu(float &axg, float &ayg, float &azg,
                    float &gxd, float &gyd, float &gzd) {
  int16_t ax, ay, az, gx, gy, gz;
  mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);
  // Remap axes here if the board is mounted differently
  axg = ax / 16384.0f;  ayg = ay / 16384.0f;  azg = az / 16384.0f;   // +/-2g
  gxd = gx / 131.0f;    gyd = gy / 131.0f;    gzd = gz / 131.0f;     // +/-250 dps
}

// Mahony filter (6-DOF). Accel only corrects roll/pitch; yaw is gyro-only.
static void mahonyUpdate(float gx, float gy, float gz,   // rad/s
                         float ax, float ay, float az,   // g
                         float dt) {
  float aNorm = sqrtf(ax*ax + ay*ay + az*az);
  // Only trust accel when it's close to 1g (i.e. not being shaken/accelerated)
  if (aNorm > 0.001f && fabsf(aNorm - 1.0f) < ACC_TRUST_G) {
    ax /= aNorm; ay /= aNorm; az /= aNorm;
    float vx = 2.0f * (q1*q3 - q0*q2);
    float vy = 2.0f * (q0*q1 + q2*q3);
    float vz = q0*q0 - q1*q1 - q2*q2 + q3*q3;
    gx += KP * (ay*vz - az*vy);
    gy += KP * (az*vx - ax*vz);
    gz += KP * (ax*vy - ay*vx);
  }
  float h = 0.5f * dt;
  float n0 = q0 + (-q1*gx - q2*gy - q3*gz) * h;
  float n1 = q1 + ( q0*gx + q2*gz - q3*gy) * h;
  float n2 = q2 + ( q0*gy - q1*gz + q3*gx) * h;
  float n3 = q3 + ( q0*gz + q1*gy - q2*gx) * h;
  float n = sqrtf(n0*n0 + n1*n1 + n2*n2 + n3*n3);
  q0 = n0/n; q1 = n1/n; q2 = n2/n; q3 = n3/n;
}

// Soft deadband + per-side range normalisation -> [-1, 1]
static float normalizeAngle(float deg, float romNeg, float romPos) {
  float mag = fabsf(deg);
  if (mag < DEADBAND_DEG) return 0.0f;
  float lim = (deg >= 0) ? romPos : romNeg;
  float n = (mag - DEADBAND_DEG) / fmaxf(lim - DEADBAND_DEG, 1.0f);
  if (n > 1.0f) n = 1.0f;
  return (deg >= 0) ? n : -n;
}

static void say(const char *msg) {   // '#' lines are status text; the PC ignores them
  Serial.println(msg);
  SerialBT.print("# "); SerialBT.println(msg);
}

// ================= CALIBRATION =================
static void calibrateGyro() {
  say("Calibrating gyro - keep the sensor still...");
  double sum[3] = {0, 0, 0};
  const int N = 400;                          // ~2 s
  for (int i = 0; i < N; i++) {
    float a[3], g[3];
    readImu(a[0], a[1], a[2], g[0], g[1], g[2]);
    for (int k = 0; k < 3; k++) sum[k] += g[k];
    delay(5);
  }
  for (int k = 0; k < 3; k++) gyroBias[k] = sum[k] / N;
}

static void initOrientationFromAccel() {
  double sx = 0, sy = 0, sz = 0;
  const int N = 100;
  for (int i = 0; i < N; i++) {
    float a[3], g[3];
    readImu(a[0], a[1], a[2], g[0], g[1], g[2]);
    sx += a[0]; sy += a[1]; sz += a[2];
    delay(5);
  }
  float ax = sx/N, ay = sy/N, az = sz/N;
  float r = atan2f(ay, az);
  float p = atan2f(-ax, sqrtf(ay*ay + az*az));
  float cr = cosf(r/2), sr = sinf(r/2), cp = cosf(p/2), sp = sinf(p/2);
  q0 = cr*cp;  q1 = sr*cp;  q2 = cr*sp;  q3 = -sr*sp;   // yaw = 0
}

static void setNeutral() {                    // current pose becomes "zero"
  z0 = q0; z1 = q1; z2 = q2; z3 = q3;
  steerSm = moveSm = 0;
  say("Neutral pose set");
}

static float currentMoveAngle() {
  float v = (MOVE_X_SOURCE == 0) ? yawRel : (MOVE_X_SOURCE == 1) ? pitchRel : rollRel;
  return MOVE_SIGN * v;
}

static void handleCommand(char c) {
  switch (c) {
    case 'c': setNeutral(); break;                                            // recenter
    case 'b': calibrateGyro(); break;                                         // redo gyro bias
    case 'r': rollRomPos = fmaxf(STEER_SIGN * rollRel, 10.0f); say("Roll ROM right saved"); break;
    case 'l': rollRomNeg = fmaxf(-STEER_SIGN * rollRel, 10.0f); say("Roll ROM left saved"); break;
    case 'd': moveRomPos = fmaxf(currentMoveAngle(), 10.0f);  say("Move ROM right saved"); break;
    case 'a': moveRomNeg = fmaxf(-currentMoveAngle(), 10.0f); say("Move ROM left saved"); break;
  }
}

// ================= SETUP / LOOP =================
void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  Wire.setClock(400000);

  mpu.initialize();
  if (!mpu.testConnection()) Serial.println("MPU6050 not found!");
  mpu.setFullScaleGyroRange(MPU6050_GYRO_FS_250);   // best resolution for slow motion
  mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_2);
  mpu.setDLPFMode(4);                               // ~20 Hz low-pass: kills noise, fine for slow moves
  mpu.setRate(0);                                   // 1 kHz internal, we poll at 200 Hz

  SerialBT.begin("ESP32_HTN");
  say("Bluetooth active. Pair with your computer.");

  calibrateGyro();
  initOrientationFromAccel();
  setNeutral();
  say("Ready. Commands: c=center b=gyro-cal l/r=roll limits a/d=move limits");
}

void loop() {
  static uint32_t lastImuUs = micros();
  static uint32_t lastOutMs = millis();

  uint32_t nowUs = micros();
  if (nowUs - lastImuUs >= IMU_DT_US) {
    float dt = (nowUs - lastImuUs) * 1e-6f;
    lastImuUs = nowUs;

    float ax, ay, az, gx, gy, gz;
    readImu(ax, ay, az, gx, gy, gz);

    // Track gyro bias while stationary (keeps slow-motion accuracy over time)
    if (fabsf(gx - gyroBias[0]) < STILL_DPS &&
        fabsf(gy - gyroBias[1]) < STILL_DPS &&
        fabsf(gz - gyroBias[2]) < STILL_DPS) {
      if (++stillCount > 200) {                    // still for ~1 s
        gyroBias[0] += BIAS_ALPHA * (gx - gyroBias[0]);
        gyroBias[1] += BIAS_ALPHA * (gy - gyroBias[1]);
        gyroBias[2] += BIAS_ALPHA * (gz - gyroBias[2]);
      }
    } else {
      stillCount = 0;
    }

    mahonyUpdate((gx - gyroBias[0]) * DEG_TO_RAD,
                 (gy - gyroBias[1]) * DEG_TO_RAD,
                 (gz - gyroBias[2]) * DEG_TO_RAD,
                 ax, ay, az, dt);

    // Orientation relative to the neutral pose: q_rel = conj(q_zero) * q
    float r0, r1, r2, r3;
    quatMul(z0, -z1, -z2, -z3, q0, q1, q2, q3, r0, r1, r2, r3);
    rollRel  = atan2f(2*(r0*r1 + r2*r3), 1 - 2*(r1*r1 + r2*r2)) * RAD_TO_DEG;
    float s  = constrain(2*(r0*r2 - r3*r1), -1.0f, 1.0f);
    pitchRel = asinf(s) * RAD_TO_DEG;
    yawRel   = atan2f(2*(r0*r3 + r1*r2), 1 - 2*(r2*r2 + r3*r3)) * RAD_TO_DEG;
  }

  if (millis() - lastOutMs >= OUT_PERIOD_MS) {
    lastOutMs += OUT_PERIOD_MS;

    float steerRaw = normalizeAngle(STEER_SIGN * rollRel, rollRomNeg, rollRomPos);
    float moveRaw  = normalizeAngle(currentMoveAngle(),  moveRomNeg, moveRomPos);
    steerSm += OUT_ALPHA * (steerRaw - steerSm);
    moveSm  += OUT_ALPHA * (moveRaw  - moveSm);

    // roll,pitch,yaw (deg, relative to neutral), steer, moveX (-1..1)
    char buf[80];
    int n = snprintf(buf, sizeof(buf), "%.2f,%.2f,%.2f,%.3f,%.3f\n",
                     rollRel, pitchRel, yawRel, steerSm, moveSm);
    SerialBT.write((const uint8_t *)buf, n);
    Serial.write((const uint8_t *)buf, n);
  }

  while (SerialBT.available()) handleCommand(SerialBT.read());
  while (Serial.available())   handleCommand(Serial.read());
}