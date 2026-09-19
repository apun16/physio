#include "BluetoothSerial.h"
#include <Wire.h>
#include <MPU6050.h>

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error Bluetooth is not enabled!
#endif

BluetoothSerial SerialBT;
MPU6050 mpu;
int16_t ax, ay, az;

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  mpu.initialize();

  // Start Bluetooth Classic Serial
  SerialBT.begin("ESP32_HTN"); 
  Serial.println("Bluetooth device active. Pair it with your computer!");
}

void loop() {
  mpu.getAcceleration(&ax, &ay, &az);
  // float roll = atan2(ay, az) * 180.0 / PI;
  float pitch = atan2(-ax, sqrt((long)ay * ay + (long)az * az)) * 180.0 / PI;
  float roll  = atan2(ay, az) * 180.0 / PI; // This axis typically tracks wrist twist (supination/pronation)
  // This streams data out of the Bluetooth serial "cable"
  SerialBT.print(pitch);
  SerialBT.print(",");
  SerialBT.println(roll);

  delay(50);
}