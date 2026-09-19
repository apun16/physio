#include <Wire.h>
#include <MPU6050.h>

MPU6050 mpu;

int16_t ax, ay, az;
int16_t gx, gy, gz;

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22); // ESP32 DevKit V1 default I2C pins
  
  mpu.initialize();

  Serial.println("Initializing MPU6050...");
  if (mpu.testConnection()) {
    Serial.println("MPU6050 connection successful!");
  } else {
    Serial.println("MPU6050 connection failed");
    while (1) {
      delay(10);
    }
  }
}

void loop() {
  // Read raw accelerometer values
  mpu.getAcceleration(&ax, &ay, &az);

  // Calculate Pitch and Roll angles in degrees from accelerometer data
  float pitch = atan2(-ax, sqrt((long)ay * ay + (long)az * az)) * 180.0 / PI;
  float roll  = atan2(ay, az) * 180.0 / PI; // This axis typically tracks wrist twist (supination/pronation)

  // Print results to Serial Monitor
  // Serial.print("Pitch: ");
  // Serial.print(pitch);
  // Serial.print("°  |  Roll (Twist): ");
  // Serial.print(roll);
  // Serial.println("°");
  Serial.print(pitch);
  Serial.print(",");
  Serial.println(roll);

  delay(30);
}