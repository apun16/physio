#include "BluetoothSerial.h"
#include <Wire.h>
#include <MPU6050.h>

// Hardware power registers to prevent battery brownout reboots
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error Bluetooth is not enabled!
#endif

// ================= CONFIG =================
#define STEER_SIGN     1.0f  // Flip to -1 if pitching gives reversed steering
#define MOVE_X_SIGN    1.0f  // Flip to -1 to invert left/right direction
#define MOVE_Y_SIGN    1.0f  // Flip to -1 to invert up/down direction

#define MOVE_X_SOURCE  0     // 0 = yaw,   1 = pitch, 2 = roll
#define MOVE_Y_SOURCE  1     // 0 = pitch, 1 = roll,  2 = yaw

// FSR Pin & Calibration Settings
const int FSR_PIN     = 34;   // GPIO34 (ADC1 Channel 6)
int fsrMinRaw         = 100;  // Resting threshold
int fsrMaxRaw         = 3500; // Hard squeeze threshold

const float DEADBAND_DEG      = 2.0f;  
const float DEFAULT_PITCH_ROM = 45.0f; // Default +/- range mapped to full steering
const float DEFAULT_MOVE_ROM  = 30.0f; 
const float OUT_ALPHA         = 0.15f; 
const float KP                = 1.0f;  
const float ACC_TRUST_G       = 0.15f; 
const float STILL_DPS         = 1.0f;  
const float BIAS_ALPHA        = 0.002f;

const uint32_t IMU_DT_US     = 5000;   // 200 Hz filter update
const uint32_t OUT_PERIOD_MS = 20;     // 50 Hz output

// ================= STATE =================
BluetoothSerial SerialBT;
MPU6050 mpu;

float q0 = 1, q1 = 0, q2 = 0, q3 = 0;          
float z0 = 1, z1 = 0, z2 = 0, z3 = 0;          
float gyroBias[3] = {0, 0, 0};                 
uint16_t stillCount = 0;

float pitchRomPos  = DEFAULT_PITCH_ROM, pitchRomNeg  = DEFAULT_PITCH_ROM;
float moveXRomPos  = DEFAULT_MOVE_ROM,  moveXRomNeg  = DEFAULT_MOVE_ROM;
float moveYRomPos  = DEFAULT_MOVE_ROM,  moveYRomNeg  = DEFAULT_MOVE_ROM;

float rollRel = 0, pitchRel = 0, yawRel = 0;   
float steerSm = 0, moveXSm = 0, moveYSm = 0, squeezeSm = 0;
int rawFsr = 0;

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
  axg = ax / 16384.0f;  ayg = ay / 16384.0f;  azg = az / 16384.0f;   
  gxd = gx / 131.0f;    gyd = gy / 131.0f;    gzd = gz / 131.0f;     
}

static void mahonyUpdate(float gx, float gy, float gz,   
                         float ax, float ay, float az,   
                         float dt) {
  float aNorm = sqrtf(ax*ax + ay*ay + az*az);
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

static float normalizeAngle(float deg, float romNeg, float romPos) {
  float mag = fabsf(deg);
  if (mag < DEADBAND_DEG) return 0.0f;
  float lim = (deg >= 0) ? romPos : romNeg;
  float n = (mag - DEADBAND_DEG) / fmaxf(lim - DEADBAND_DEG, 1.0f);
  if (n > 1.0f) n = 1.0f;
  return (deg >= 0) ? n : -n;
}

static void say(const char *msg) {   
  Serial.println(msg);
  if (SerialBT.hasClient()) {
    SerialBT.print("# "); SerialBT.println(msg);
  }
}

// ================= CALIBRATION =================
static void calibrateGyro() {
  say("Calibrating gyro - keep the sensor still...");
  double sum[3] = {0, 0, 0};
  const int N = 400;                                         
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
  q0 = cr*cp;  q1 = sr*cp;  q2 = cr*sp;  q3 = -sr*sp;   
}

static void setNeutral() {                    
  z0 = q0; z1 = q1; z2 = q2; z3 = q3;
  steerSm = moveXSm = moveYSm = 0;
  say("Neutral pose set");
}

static float currentMoveXAngle() {
  float v = (MOVE_X_SOURCE == 0) ? yawRel : (MOVE_X_SOURCE == 1) ? pitchRel : rollRel;
  return MOVE_X_SIGN * v;
}

static float currentMoveYAngle() {
  float v = (MOVE_Y_SOURCE == 0) ? pitchRel : (MOVE_Y_SOURCE == 1) ? rollRel : yawRel;
  return MOVE_Y_SIGN * v;
}

static void handleCommand(char c) {
  switch (c) {
    case 'c': setNeutral(); break;                                            
    case 'b': calibrateGyro(); break;                                         
    case 'r': pitchRomPos = fmaxf(STEER_SIGN * pitchRel, 10.0f); say("Pitch ROM right saved"); break;
    case 'l': pitchRomNeg = fmaxf(-STEER_SIGN * pitchRel, 10.0f); say("Pitch ROM left saved"); break;
    case 'd': moveXRomPos = fmaxf(currentMoveXAngle(), 10.0f);   say("Move X right saved"); break;
    case 'a': moveXRomNeg = fmaxf(-currentMoveXAngle(), 10.0f);  say("Move X left saved"); break;
    case 'w': moveYRomPos = fmaxf(currentMoveYAngle(), 10.0f);   say("Move Y up saved"); break;
    case 's': moveYRomNeg = fmaxf(-currentMoveYAngle(), 10.0f);  say("Move Y down saved"); break;
    case 'f': fsrMinRaw   = rawFsr; say("FSR Rest baseline saved"); break;
    case 'm': fsrMaxRaw   = max(rawFsr, fsrMinRaw + 500); say("FSR Max Squeeze saved"); break;
  }
}

// ================= SETUP / LOOP =================
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); 

  Serial.begin(115200);
  delay(500); 

  // Configure ADC for FSR 402 reading
  analogSetAttenuation(ADC_11db);
  pinMode(FSR_PIN, INPUT);

  Wire.begin(21, 22);
  Wire.setClock(400000);

  mpu.initialize();
  if (!mpu.testConnection()) Serial.println("MPU6050 not found!");
  mpu.setFullScaleGyroRange(MPU6050_GYRO_FS_250);   
  mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_2);
  mpu.setDLPFMode(4);                                
  mpu.setRate(0);                                   

  SerialBT.begin("ESP32_HTN");
  Serial.println("Bluetooth initialized.");

  calibrateGyro();
  initOrientationFromAccel();
  setNeutral();
  say("Ready. Commands: c=center b=gyro l/r=pitch a/d=X w/s=Y f=fsr_min m=fsr_max");
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

    if (fabsf(gx - gyroBias[0]) < STILL_DPS &&
        fabsf(gy - gyroBias[1]) < STILL_DPS &&
        fabsf(gz - gyroBias[2]) < STILL_DPS) {
      if (++stillCount > 200) {                    
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

    float r0, r1, r2, r3;
    quatMul(z0, -z1, -z2, -z3, q0, q1, q2, q3, r0, r1, r2, r3);
    rollRel  = atan2f(2*(r0*r1 + r2*r3), 1 - 2*(r1*r1 + r2*r2)) * RAD_TO_DEG;
    float s  = constrain(2*(r0*r2 - r3*r1), -1.0f, 1.0f);
    pitchRel = asinf(s) * RAD_TO_DEG;
    yawRel   = atan2f(2*(r0*r3 + r1*r2), 1 - 2*(r2*r2 + r3*r3)) * RAD_TO_DEG;

    // Read & constrain raw FSR force value
    rawFsr = analogRead(FSR_PIN);
    int normFsrInt = map(rawFsr, fsrMinRaw, fsrMaxRaw, 0, 1000);
    normFsrInt = constrain(normFsrInt, 0, 1000);
    float squeezeTarget = normFsrInt / 1000.0f; // Scale to 0.0 - 1.0 float
    squeezeSm += OUT_ALPHA * (squeezeTarget - squeezeSm);
  }

  if (millis() - lastOutMs >= OUT_PERIOD_MS) {
    lastOutMs += OUT_PERIOD_MS;

    float steerRaw = normalizeAngle(STEER_SIGN * pitchRel, pitchRomNeg, pitchRomPos);
    float moveXRaw = normalizeAngle(currentMoveXAngle(), moveXRomNeg, moveXRomPos);
    float moveYRaw = normalizeAngle(currentMoveYAngle(), moveYRomNeg, moveYRomPos);

    steerSm += OUT_ALPHA * (steerRaw - steerSm);
    moveXSm += OUT_ALPHA * (moveXRaw - moveXSm);
    moveYSm += OUT_ALPHA * (moveYRaw - moveYSm);

    // CSV Output: roll,pitch,yaw,steer,moveX,moveY,rawFsr,squeeze
    char buf[120];
    int n = snprintf(buf, sizeof(buf), "%.2f,%.2f,%.2f,%.3f,%.3f,%.3f,%d,%.3f\n",
                     rollRel, pitchRel, yawRel, steerSm, moveXSm, moveYSm, rawFsr, squeezeSm);

    if (SerialBT.hasClient()) {
      SerialBT.write((const uint8_t *)buf, n);
    }
    Serial.write((const uint8_t *)buf, n);
  }

  while (SerialBT.available()) handleCommand(SerialBT.read());
  while (Serial.available())   handleCommand(Serial.read());
}