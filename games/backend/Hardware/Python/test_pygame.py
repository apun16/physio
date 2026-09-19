import sys
import pygame
import serial

# --- CONFIGURATION ---
PORT = "COM7"  # Your verified Bluetooth COM port
BAUD = 115200

# Initialize Serial Connection
try:
  ser = serial.Serial(PORT, BAUD, timeout=0.1)
  print(f"Connected to ESP32 on {PORT}")
except Exception as e:
  print(f"Failed to connect to serial port: {e}")
  sys.exit()

# Initialize Pygame
pygame.init()
WIDTH, HEIGHT = 800, 600
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("IMU Linear Motion Demo")
clock = pygame.time.Clock()

# Object properties (Square representing our game item)
obj_x = WIDTH // 2
obj_y = HEIGHT // 2
obj_size = 50

running = True
while running:
  # 1. Handle Window Events (so it doesn't freeze)
  for event in pygame.event.get():
    if event.type == pygame.QUIT:
      running = False

  # 2. Read IMU Data from ESP32 over Bluetooth
  if ser.in_waiting > 0:
    line = ser.readline().decode("utf-8", errors="ignore").strip()
    if line:
      try:
        # Expecting format: "roll,ax"
        roll_str, ax_str = line.split(",")
        ax = float(ax_str)
        print(f"RAW -> Roll: {roll_str} | AX: {ax_str}")

        # --- LINEAR MOTION LOGIC ---
        # Apply deadzone to ignore hand tremors
        if abs(ax) > 1500:
          velocity_x = ax / 4000.0  # Scale down acceleration to pixels/frame
        else:
          velocity_x = 0.0

        # Update position
        obj_x += velocity_x

        # Keep object inside screen bounds
        obj_x = max(0, min(WIDTH - obj_size, obj_x))

      except ValueError:
        pass  # Skip malformed lines

  # 3. Render Graphics
  screen.fill((30, 30, 30))  # Dark background

  # Draw a moving square controlled by your arm movement
  pygame.draw.rect(
      screen, (0, 255, 128), (int(obj_x), obj_y - obj_size // 2, obj_size, obj_size)
  )

  pygame.display.flip()
  clock.tick(60)  # Run at 60 FPS

# Cleanup
ser.close()
pygame.quit()
sys.exit()

