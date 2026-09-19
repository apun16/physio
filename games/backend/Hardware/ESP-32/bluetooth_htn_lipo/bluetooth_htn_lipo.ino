#include "BluetoothSerial.h"
#include <Wire.h>
#include <MPU6050.h>

// Check if Bluetooth is enabled in the ESP32 core
#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error Bluetooth is not enabled!
#endif

BluetoothSerial SerialBT;
MPU6050 mpu;

int16_t ax, ay, az;

void setup() {
  Serial.begin(115200);
  
  // Initialize I2C (Pins 21 and 22 are standard for ESP32 DevKit V1)
  Wire.begin(21, 22);
  
  // Initialize MPU6050 (using your functional clone library setup)
  mpu.initialize();
  if (!mpu.testConnection()) {
    Serial.println("MPU6050 connection failed! Check your wiring.");
  } else {
    Serial.println("MPU6050 initialized successfully!");
  }

  // Start Bluetooth Classic Serial (matches the device name we paired earlier)
  SerialBT.begin("ESP32_Steering_BT"); 
  Serial.println("Bluetooth device active. Ready to connect to PC!");
}

void loop() {
  // Read accelerometer data from MPU6050
  mpu.getAcceleration(&ax, &ay, &az);

  // 1. Calculate Roll (Wrist rotation angle)
  float roll = atan2(ay, az) * 180.0 / PI;

  // 2. Transmit packet over Bluetooth Serial as "roll,ax"
  SerialBT.print(roll);
  SerialBT.print(",");
  SerialBT.println(ax);

  // ~33 updates per second
  delay(30);
}