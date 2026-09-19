import serial
import glob
import time

def find_esp32_port():
    """Scans macOS /dev/tty.* devices for Bluetooth or USB serial ports."""
    # Check for Bluetooth serial pair first, then fall back to USB serial adapters
    ports = glob.glob('/dev/tty.ESP32*') + glob.glob('/dev/tty.usbserial*') + glob.glob('/dev/tty.wchusbserial*')
    return ports[0] if ports else None

def main():
    print("Searching for ESP32 serial port on macOS...")
    port_name = find_esp32_port()

    if not port_name:
        print("\n❌ No ESP32 device found in /dev/tty.*")
        print("Troubleshooting checklist:")
        print(" 1. Pair 'ESP32_HTN' in macOS System Settings -> Bluetooth.")
        print(" 2. If testing via USB cable, ensure the driver is installed.")
        print(" 3. Run 'ls /dev/tty.*' in Terminal to view all available ports manually.")
        return

    print(f"\n✅ Port Found: {port_name}")
    print("Connecting at 115200 baud...\n" + "-" * 40)

    try:
        ser = serial.Serial(port_name, 115200, timeout=1)
        ser.reset_input_buffer()
        print("Connected! Listening for incoming data (Press Ctrl+C to stop):\n")

        while True:
            if ser.in_waiting > 0:
                # Read line from ESP32, strip trailing newlines, decode to string
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line:
                    print(f"[{time.strftime('%H:%M:%S')}] RAW DATA: {line}")

    except serial.SerialException as e:
        print(f"\n❌ Serial Error: {e}")
        print("Check if Arduino IDE Serial Monitor or another script is holding the port open.")
    except KeyboardInterrupt:
        print("\nStopping listener and closing port.")
        ser.close()

if __name__ == '__main__':
    main()