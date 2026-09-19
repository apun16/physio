import serial
import time

PORT = "COM7"
BAUD = 115200

ser = serial.Serial(
    PORT,
    BAUD,
    timeout=0.01
)

time.sleep(2)


def get_imu_data():
    """
    Returns:

        supination
        pitch
        roll
        linear_x
        linear_y
        linear_z

    or None if no valid packet is available.
    """

    if ser.in_waiting == 0:
        return None

    try:
        line = ser.readline().decode("utf-8").strip()

        if not line:
            return None

        values = line.split(",")

        if len(values) != 6:
            return None

        supination = float(values[0])
        pitch = float(values[1])
        roll = float(values[2])

        linear_x = float(values[3])
        linear_y = float(values[4])
        linear_z = float(values[5])

        return (
            supination,
            pitch,
            roll,
            linear_x,
            linear_y,
            linear_z
        )

    except (ValueError, UnicodeDecodeError):
        return None


# ------------------------------------------------------------
# TEST
# ------------------------------------------------------------

while True:

    data = get_imu_data()

    if data is not None:

        supination, pitch, roll, lx, ly, lz = data

        print(
            f"Supination: {supination:7.2f}° | "
            f"Pitch: {pitch:7.2f}° | "
            f"Roll: {roll:7.2f}° | "
            f"Linear: "
            f"X={lx:6.2f} "
            f"Y={ly:6.2f} "
            f"Z={lz:6.2f}"
        )