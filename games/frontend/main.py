from __future__ import annotations

import argparse
import math
import os
from dataclasses import dataclass
from typing import Protocol

import pygame


WIDTH = 1280
HEIGHT = 720
FPS = 60
TRACK_LENGTH = 18_000.0
MAX_SPEED = 920.0
ROAD_EDGE = 1.28

INK = (28, 38, 57)
WHITE = (255, 252, 236)
YELLOW = (255, 218, 57)
ORANGE = (255, 105, 70)
TEAL = (49, 205, 186)
SKY = (255, 235, 104)
GRASS = (74, 220, 40)
GRASS_ALT = (64, 205, 34)
ROAD = (101, 103, 99)
ROAD_ALT = (98, 100, 96)
RUNOFF = (255, 226, 82)


@dataclass(slots=True)
class SteeringSample:
    steer: float
    accelerate: float = 1.0


class SteeringSource(Protocol):
    def read(self, dt: float) -> SteeringSample: ...


class KeyboardSteering:
    """Keyboard adapter. A hardware adapter only needs the same read method."""

    def __init__(self) -> None:
        self._steer = 0.0

    def read(self, dt: float) -> SteeringSample:
        keys = pygame.key.get_pressed()
        left = keys[pygame.K_LEFT] or keys[pygame.K_a]
        right = keys[pygame.K_RIGHT] or keys[pygame.K_d]
        target = float(right) - float(left)
        smoothing = 1.0 - math.exp(-10.0 * dt)
        self._steer += (target - self._steer) * smoothing
        return SteeringSample(steer=self._steer)


@dataclass(slots=True)
class RaceState:
    distance: float = 0.0
    speed: float = 0.0
    lateral: float = 0.0
    heading: float = 0.0
    lap: int = 1
    coins: int = 0
    elapsed: float = 0.0
    steer: float = 0.0
    off_road: bool = False
    final_lap_until: float = 0.0

    @property
    def progress(self) -> float:
        return self.distance / TRACK_LENGTH


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def lerp(a: float, b: float, amount: float) -> float:
    return a + (b - a) * amount


def rounded_rect(
    surface: pygame.Surface,
    rect: pygame.Rect,
    color: tuple[int, ...],
    radius: int,
    border: int = 0,
    border_color: tuple[int, ...] = INK,
) -> None:
    pygame.draw.rect(surface, color, rect, border_radius=radius)
    if border:
        pygame.draw.rect(
            surface, border_color, rect, width=border, border_radius=radius
        )


def outlined_text(
    surface: pygame.Surface,
    font: pygame.font.Font,
    text: str,
    position: tuple[int, int],
    color: tuple[int, int, int] = WHITE,
    outline: tuple[int, int, int] = INK,
    thickness: int = 3,
    anchor: str = "topleft",
) -> pygame.Rect:
    main = font.render(text, True, color)
    rect = main.get_rect()
    setattr(rect, anchor, position)
    for ox, oy in (
        (-thickness, 0),
        (thickness, 0),
        (0, -thickness),
        (0, thickness),
        (-thickness, -thickness),
        (thickness, -thickness),
        (-thickness, thickness),
        (thickness, thickness),
    ):
        surface.blit(font.render(text, True, outline), rect.move(ox, oy))
    surface.blit(main, rect)
    return rect


class Fonts:
    def __init__(self) -> None:
        bold = pygame.font.match_font("arialrounded,arial", bold=True)
        self.tiny = pygame.font.Font(bold, 16)
        self.small = pygame.font.Font(bold, 22)
        self.medium = pygame.font.Font(bold, 34)
        self.large = pygame.font.Font(bold, 64)
        self.place = pygame.font.Font(bold, 132)
        self.countdown = pygame.font.Font(bold, 176)


class PulseCircuit:
    def __init__(self, smoke_test: bool = False) -> None:
        pygame.init()
        pygame.display.set_caption("Pulse Circuit")
        flags = 0 if smoke_test else pygame.RESIZABLE
        self.screen = pygame.display.set_mode((WIDTH, HEIGHT), flags)
        self.frame = pygame.Surface((WIDTH, HEIGHT)).convert()
        self.clock = pygame.time.Clock()
        self.fonts = Fonts()
        self.state = RaceState()
        self.input: SteeringSource = KeyboardSteering()
        self.running = True
        self.smoke_test = smoke_test
        self.frames = 0

    def update(self, dt: float) -> None:
        state = self.state
        state.elapsed += dt
        sample = self.input.read(dt)
        state.steer = sample.steer

        racing = state.elapsed >= 3.0
        state.off_road = abs(state.lateral) > ROAD_EDGE
        target_speed = MAX_SPEED
        if state.off_road:
            target_speed *= 0.43
        if not racing:
            target_speed = 0.0

        speed_response = 2.25 if target_speed > state.speed else 4.0
        state.speed = lerp(
            state.speed,
            target_speed * sample.accelerate,
            1.0 - math.exp(-speed_response * dt),
        )

        if racing:
            speed_ratio = state.speed / MAX_SPEED
            turn_rate = 0.65 + speed_ratio * 0.65
            state.heading += sample.steer * turn_rate * dt

            # The road's direction changes underneath the car. This is not an
            # assist: if the player does not steer into a bend, the car keeps
            # its world heading and drifts toward the outside edge.
            road_rotation = clamp(
                (self.curve_at(260.0) - self.curve_at(0.0)) * 3.0,
                -0.55,
                0.55,
            )
            state.heading -= road_rotation * speed_ratio * 0.78 * dt
            state.heading = clamp(state.heading, -0.82, 0.82)

            # Heading persists when input is released. The player must
            # counter-steer to straighten the car; there is no centering or
            # track-following correction.
            state.lateral += (
                math.sin(state.heading) * (0.42 + speed_ratio * 0.9) * dt
            )
            state.lateral = clamp(state.lateral, -1.65, 1.65)

            previous = state.distance
            state.distance = (state.distance + state.speed * dt) % TRACK_LENGTH
            if state.distance < previous:
                state.lap += 1
                if state.lap == 3:
                    state.final_lap_until = state.elapsed + 2.0
                if state.lap > 3:
                    state.lap = 1
                    state.coins = 0

    def curve_at(self, distance_ahead: float) -> float:
        world = self.state.distance + distance_ahead
        long_curve = math.sin(world / 2500.0) * 0.56
        short_curve = math.sin(world / 980.0 + 0.8) * 0.20
        return long_curve + short_curve

    def road_center(self, depth: float, road_width: float) -> float:
        distance_ahead = (1.0 - depth) * 3800.0
        curve = self.curve_at(distance_ahead) - self.curve_at(0.0)
        camera_shift = self.state.lateral * road_width * 0.66
        return WIDTH / 2 + curve * WIDTH * depth * 0.43 - camera_shift * depth

    def draw_background(self) -> None:
        frame = self.frame
        horizon = 180

        # A soft sky gradient and atmospheric horizon replace the flat fill.
        sky_top = (102, 192, 242)
        sky_bottom = (255, 231, 129)
        for y in range(horizon):
            amount = y / horizon
            color = tuple(
                int(lerp(sky_top[channel], sky_bottom[channel], amount))
                for channel in range(3)
            )
            pygame.draw.line(frame, color, (0, y), (WIDTH, y))

        pygame.draw.circle(frame, (255, 244, 178), (82, 58), 50)
        pygame.draw.circle(frame, (255, 230, 112), (82, 58), 38)

        # Chunky layered clouds echo the simple, graphic scenery.
        for cloud_x, cloud_y, scale in (
            (160, 72, 1.0),
            (560, 95, 0.72),
            (1025, 58, 1.12),
        ):
            cloud_color = (247, 253, 246)
            pygame.draw.ellipse(
                frame,
                cloud_color,
                (cloud_x - 58 * scale, cloud_y, 116 * scale, 35 * scale),
            )
            pygame.draw.circle(
                frame,
                cloud_color,
                (int(cloud_x - 30 * scale), int(cloud_y + 3 * scale)),
                int(27 * scale),
            )
            pygame.draw.circle(
                frame,
                cloud_color,
                (int(cloud_x + 8 * scale), int(cloud_y - 8 * scale)),
                int(34 * scale),
            )
            pygame.draw.circle(
                frame,
                cloud_color,
                (int(cloud_x + 40 * scale), int(cloud_y + 5 * scale)),
                int(24 * scale),
            )

        pygame.draw.rect(frame, (77, 199, 52), (0, horizon, WIDTH, HEIGHT - horizon))

        # Smooth neon hills sit in broad layers behind the road.
        hills = (
            (70, horizon + 43, 118, (49, 188, 48)),
            (300, horizon + 70, 82, (94, 218, 61)),
            (960, horizon + 62, 96, (86, 211, 55)),
            (1190, horizon + 38, 132, (43, 177, 52)),
        )
        for x, y, radius, color in hills:
            shadow_color = tuple(max(0, channel - 38) for channel in color)
            pygame.draw.circle(frame, shadow_color, (x + 9, y + 8), radius)
            pygame.draw.circle(frame, color, (x, y), radius)
            pygame.draw.arc(
                frame,
                tuple(min(255, channel + 38) for channel in color),
                (x - radius, y - radius, radius * 2, radius * 2),
                math.radians(198),
                math.radians(300),
                max(3, radius // 13),
            )
            pygame.draw.circle(
                frame,
                (127, 231, 85),
                (x - radius // 3, y - radius // 3),
                max(9, radius // 8),
            )
            pygame.draw.circle(
                frame,
                (38, 148, 56),
                (x + radius // 4, y - radius // 6),
                max(7, radius // 11),
            )

        # Bright roadside towers read like a playful game world without using
        # franchise-specific assets.
        for x, color in ((225, (249, 83, 70)), (1075, (63, 119, 230))):
            pygame.draw.rect(frame, color, (x - 20, horizon - 35, 40, 88))
            pygame.draw.ellipse(frame, WHITE, (x - 25, horizon - 45, 50, 20))
            pygame.draw.rect(frame, INK, (x - 6, horizon + 20, 12, 33), border_radius=6)

        # Tall rounded topiary columns match the reference scenery better
        # than naturalistic trunks and leafy circles.
        tree_positions = (30, 320, 890, 1245)
        for index, x in enumerate(tree_positions):
            height = 78 + (index % 2) * 24
            top = horizon - height + 24
            trunk_color = (56, 120, 38)
            pygame.draw.ellipse(
                frame,
                (45, 137, 43),
                (x - 31, horizon - 2, 67, 15),
            )
            pygame.draw.rect(
                frame,
                trunk_color,
                (x - 13, top, 26, height),
                border_radius=12,
            )
            canopy = pygame.Rect(x - 20, top - 30, 40, 76)
            pygame.draw.rect(
                frame,
                (77, 155, 45),
                canopy,
                border_radius=19,
            )
            pygame.draw.polygon(
                frame,
                (65, 139, 39),
                (
                    (x - 16, top + 20),
                    (x + 16, top + 20),
                    (x + 11, top + 42),
                    (x - 11, top + 42),
                ),
            )
            pygame.draw.rect(
                frame,
                (111, 184, 60),
                (x - 10, top - 14, 7, 43),
                border_radius=3,
            )
            pygame.draw.rect(
                frame,
                (36, 91, 32),
                (x + 9, top - 9, 7, 48),
                border_radius=3,
            )

    def draw_road(self) -> None:
        frame = self.frame
        horizon = 180
        bottom = HEIGHT + 20
        bands = 96
        previous_y = horizon
        previous_width = 28.0
        previous_center = WIDTH / 2
        barrier_colors = (
            (247, 244, 222),
            (239, 76, 67),
            (52, 116, 226),
            (54, 181, 84),
            (245, 185, 45),
        )

        for index in range(1, bands + 1):
            depth = index / bands
            curved_depth = depth * depth
            y = horizon + curved_depth * (bottom - horizon)
            width = lerp(28.0, WIDTH * 0.68, curved_depth)
            center = self.road_center(curved_depth, width)

            # Subtract traveled distance so markings and barriers flow from
            # the horizon toward the cockpit. Adding it reverses the optic
            # flow and makes forward acceleration look like reversing.
            band_id = int(index * 0.7 - self.state.distance / 150.0)
            grass_color = GRASS if band_id % 2 else GRASS_ALT
            pygame.draw.rect(
                frame,
                grass_color,
                (0, int(previous_y), WIDTH, max(1, int(y - previous_y) + 1)),
            )

            outer_previous = previous_width * 1.12
            outer_width = width * 1.12
            pygame.draw.polygon(
                frame,
                RUNOFF,
                (
                    (previous_center - outer_previous, previous_y),
                    (previous_center + outer_previous, previous_y),
                    (center + outer_width, y),
                    (center - outer_width, y),
                ),
            )

            road_color = ROAD if band_id % 2 else ROAD_ALT
            pygame.draw.polygon(
                frame,
                road_color,
                (
                    (previous_center - previous_width, previous_y),
                    (previous_center + previous_width, previous_y),
                    (center + width, y),
                    (center - width, y),
                ),
            )

            # Crisp painted edge lines and subtle asphalt aggregate give the
            # track a material surface instead of a flat trapezoid.
            previous_edge = max(1.0, previous_width * 0.018)
            edge = max(1.0, width * 0.018)
            for side in (-1, 1):
                pygame.draw.polygon(
                    frame,
                    (238, 237, 218),
                    (
                        (
                            previous_center
                            + side * (previous_width - previous_edge),
                            previous_y,
                        ),
                        (previous_center + side * previous_width, previous_y),
                        (center + side * width, y),
                        (center + side * (width - edge), y),
                    ),
                )

            texture_hash = abs(band_id * 1103515245 + index * 12345)
            if index > 18 and texture_hash % 3 == 0:
                fraction = ((texture_hash // 17) % 1000) / 1000.0
                grain_x = int(center - width * 0.9 + fraction * width * 1.8)
                grain_y = int((previous_y + y) / 2)
                grain_radius = max(1, int(curved_depth * 2.2))
                pygame.draw.circle(
                    frame,
                    (126, 125, 116),
                    (grain_x, grain_y),
                    grain_radius,
                )

            if index > 16 and texture_hash % 7 == 0:
                side = -1 if texture_hash % 2 else 1
                grass_x = int(center + side * outer_width * 1.18)
                grass_y = int(y)
                blade_height = max(2, int(curved_depth * 8))
                pygame.draw.line(
                    frame,
                    (42, 143, 42),
                    (grass_x, grass_y),
                    (grass_x + side * 2, grass_y - blade_height),
                    max(1, int(curved_depth * 2)),
                )

            # Broken center markings move toward the camera with the track.
            if band_id % 11 < 5:
                line_previous = max(1.0, previous_width * 0.018)
                line_width = max(1.0, width * 0.018)
                pygame.draw.polygon(
                    frame,
                    (245, 244, 224),
                    (
                        (previous_center - line_previous, previous_y),
                        (previous_center + line_previous, previous_y),
                        (center + line_width, y),
                        (center - line_width, y),
                    ),
                )

            # Dense primary-color safety blocks form continuous toy walls.
            if index > 7 and band_id % 3 == 0:
                block_height = max(4, int((y - previous_y) * 4.4))
                block_width = max(6, int(width * 0.15))
                color = barrier_colors[(band_id // 3) % len(barrier_colors)]
                for side in (-1, 1):
                    bx = center + side * width * 1.18 - block_width / 2
                    by = y - block_height
                    pygame.draw.rect(
                        frame,
                        (25, 42, 55, 40),
                        (bx + 3, by + 4, block_width, block_height),
                        border_radius=max(1, block_width // 8),
                    )
                    pygame.draw.rect(
                        frame,
                        color,
                        (bx, by, block_width, block_height),
                        border_radius=max(1, block_width // 8),
                    )
                    pygame.draw.line(
                        frame,
                        tuple(min(255, channel + 42) for channel in color),
                        (int(bx + 3), int(by + 3)),
                        (int(bx + block_width - 4), int(by + 3)),
                        max(1, block_height // 8),
                    )
                    pygame.draw.line(
                        frame,
                        tuple(max(0, channel - 48) for channel in color),
                        (
                            int(bx + block_width - 3),
                            int(by + block_height // 4),
                        ),
                        (
                            int(bx + block_width - 3),
                            int(by + block_height - 3),
                        ),
                        max(1, block_width // 12),
                    )

            previous_y = y
            previous_width = width
            previous_center = center

    def draw_player_kart(self) -> None:
        frame = self.frame
        steer = self.state.steer
        heading = self.state.heading
        x = WIDTH // 2 + int(heading * 95)
        y = HEIGHT - 104

        shadow = pygame.Surface((310, 78), pygame.SRCALPHA)
        pygame.draw.ellipse(shadow, (12, 22, 30, 88), shadow.get_rect())
        frame.blit(shadow, (x - 155, y + 43))

        # Wide tires and fenders make this read as a sit-in car rather than an
        # exposed kart or motorcycle.
        for wx in (-119, 85):
            rounded_rect(
                frame,
                pygame.Rect(x + wx, y - 3, 38, 91),
                (18, 25, 34),
                12,
            )
            pygame.draw.rect(
                frame,
                (66, 75, 82),
                (x + wx + 6, y + 11, 6, 57),
                border_radius=2,
            )

        body = pygame.Rect(x - 112, y - 15, 224, 96)
        rounded_rect(frame, body, (220, 42, 39), 31, 5, (91, 27, 31))
        pygame.draw.ellipse(frame, (244, 61, 48), (x - 122, y - 20, 72, 77))
        pygame.draw.ellipse(frame, (244, 61, 48), (x + 50, y - 20, 72, 77))

        # Dark cockpit cavity and a short blue-tinted windshield surround the
        # seated driver.
        rounded_rect(
            frame,
            pygame.Rect(x - 68, y - 104, 136, 122),
            (22, 31, 42),
            45,
            5,
            (103, 25, 29),
        )
        pygame.draw.polygon(
            frame,
            (159, 225, 226),
            (
                (x - 72, y - 104),
                (x + 72, y - 104),
                (x + 60, y - 76),
                (x - 60, y - 76),
            ),
        )
        pygame.draw.line(
            frame, (34, 71, 86), (x - 72, y - 104), (x + 72, y - 104), 6
        )

        # The driver sits down inside the cockpit instead of standing above a
        # flat kart deck.
        pygame.draw.circle(frame, (220, 38, 39), (x - 37, y - 69), 24)
        pygame.draw.circle(frame, (220, 38, 39), (x + 37, y - 69), 24)
        rounded_rect(
            frame,
            pygame.Rect(x - 38, y - 108, 76, 91),
            (30, 65, 207),
            23,
            3,
            (19, 39, 123),
        )
        pygame.draw.rect(frame, (218, 40, 40), (x - 27, y - 106, 54, 38))
        pygame.draw.rect(frame, (246, 205, 49), (x - 23, y - 68, 9, 9))
        pygame.draw.rect(frame, (246, 205, 49), (x + 14, y - 68, 9, 9))

        # Hair, ears, and the oversized red cap are layered from back to front.
        pygame.draw.rect(
            frame,
            (255, 196, 139),
            (x - 15, y - 111, 30, 24),
            border_radius=8,
        )
        pygame.draw.circle(frame, (72, 38, 24), (x, y - 132), 47)
        pygame.draw.circle(frame, (255, 196, 139), (x - 38, y - 127), 15)
        pygame.draw.circle(frame, (255, 196, 139), (x + 38, y - 127), 15)
        for hair_x in (-27, -13, 0, 13, 27):
            pygame.draw.circle(
                frame,
                (93, 47, 25),
                (x + hair_x, y - 108 - abs(hair_x) // 6),
                13,
            )
        pygame.draw.ellipse(frame, (220, 35, 38), (x - 52, y - 181, 104, 66))
        pygame.draw.arc(
            frame,
            (246, 70, 62),
            (x - 38, y - 171, 76, 52),
            math.radians(198),
            math.radians(338),
            4,
        )
        pygame.draw.circle(frame, (173, 22, 28), (x, y - 178), 6)
        pygame.draw.polygon(
            frame,
            (179, 24, 29),
            (
                (x - 54, y - 140),
                (x + 54, y - 140),
                (x + 40, y - 120),
                (x - 40, y - 120),
            ),
        )

        # Steering wheel and gloves remain visible inside the cockpit.
        handle_y = y - 53
        pygame.draw.line(
            frame,
            INK,
            (x - 43, handle_y + int(steer * 7)),
            (x + 43, handle_y - int(steer * 7)),
            8,
        )
        pygame.draw.circle(
            frame,
            (255, 220, 57),
            (x - 42, handle_y + int(steer * 7)),
            12,
        )
        pygame.draw.circle(
            frame,
            (255, 220, 57),
            (x + 42, handle_y - int(steer * 7)),
            12,
        )

        # Rear deck, bumper, and lights occlude the driver's lower body and
        # complete the car silhouette.
        rear = pygame.Rect(x - 101, y + 10, 202, 72)
        rounded_rect(frame, rear, (197, 31, 34), 24, 4, (91, 27, 31))
        pygame.draw.rect(frame, (246, 67, 49), (x - 85, y + 17, 170, 26), border_radius=10)
        pygame.draw.rect(frame, (31, 39, 48), (x - 88, y + 57, 176, 17), border_radius=7)
        for light_x in (x - 69, x + 51):
            pygame.draw.rect(
                frame,
                (255, 208, 58),
                (light_x, y + 43, 19, 13),
                border_radius=4,
            )
        pygame.draw.circle(frame, WHITE, (x, y + 53), 15)
        pygame.draw.circle(frame, INK, (x, y + 53), 15, width=4)

    def draw_item_slot(self) -> None:
        frame = self.frame

        def slot(rect: pygame.Rect, main: bool) -> None:
            shadow = rect.move(5, 7)
            rounded_rect(frame, shadow, (16, 24, 38), 16)
            rounded_rect(frame, rect, (240, 239, 222), 15, 4, INK)
            colors = (
                (250, 83, 78),
                (251, 210, 50),
                (65, 198, 92),
                (66, 128, 230),
            )
            for index, color in enumerate(colors):
                inset = 7 + index * 4
                pygame.draw.rect(
                    frame,
                    color,
                    rect.inflate(-inset * 2, -inset * 2),
                    width=3,
                    border_radius=max(5, 13 - index * 2),
                )
            inner = rect.inflate(-28, -28)
            rounded_rect(frame, inner, (20, 29, 43), 9)
            font = self.fonts.large if main else self.fonts.medium
            outlined_text(
                frame,
                font,
                "?",
                inner.center,
                WHITE,
                (4, 9, 17),
                3,
                "center",
            )

        # Reserve sits up-left; the larger active item overlaps it.
        slot(pygame.Rect(24, 20, 76, 76), False)
        slot(pygame.Rect(58, 56, 108, 108), True)

    def draw_minimap(self) -> None:
        center = (WIDTH - 126, 310)
        map_surface = pygame.Surface((210, 150), pygame.SRCALPHA)
        local_center = (105, 75)
        map_rect = pygame.Rect(0, 0, 170, 102)
        map_rect.center = local_center
        pygame.draw.ellipse(map_surface, (18, 28, 42, 90), map_rect, width=9)
        pygame.draw.ellipse(map_surface, (255, 255, 244, 135), map_rect, width=5)

        # A few faint rival markers give the map the same race-readability
        # even before computer-controlled karts are implemented.
        for offset, color in ((0.18, (69, 124, 230, 150)), (0.42, (255, 210, 49, 150))):
            rival_angle = (self.state.progress + offset) * math.tau
            rx = local_center[0] + math.cos(rival_angle) * 85
            ry = local_center[1] + math.sin(rival_angle) * 51
            pygame.draw.circle(map_surface, color, (int(rx), int(ry)), 5)

        angle = self.state.progress * math.tau
        px = local_center[0] + math.cos(angle) * 85
        py = local_center[1] + math.sin(angle) * 51
        pygame.draw.circle(map_surface, (255, 255, 244, 220), (int(px), int(py)), 9)
        pygame.draw.circle(map_surface, ORANGE, (int(px), int(py)), 6)
        self.frame.blit(
            map_surface,
            (center[0] - local_center[0], center[1] - local_center[1]),
        )

    def draw_hud(self) -> None:
        frame = self.frame
        self.draw_item_slot()
        self.draw_minimap()

        # Compact outlined counters float directly over the race view.
        coin_y = HEIGHT - 94
        pygame.draw.circle(frame, (145, 92, 24), (50, coin_y), 23)
        pygame.draw.circle(frame, YELLOW, (50, coin_y), 19)
        pygame.draw.circle(frame, (255, 241, 147), (50, coin_y), 10, width=4)
        outlined_text(
            frame,
            self.fonts.medium,
            f"{self.state.coins:02d}",
            (82, coin_y),
            WHITE,
            INK,
            3,
            "midleft",
        )

        flag_x = 31
        flag_y = HEIGHT - 55
        pygame.draw.line(frame, INK, (flag_x, flag_y - 21), (flag_x, flag_y + 18), 5)
        tile = 9
        for row in range(3):
            for column in range(4):
                color = WHITE if (row + column) % 2 == 0 else INK
                pygame.draw.rect(
                    frame,
                    color,
                    (
                        flag_x + 3 + column * tile,
                        flag_y - 20 + row * tile,
                        tile,
                        tile,
                    ),
                )
        outlined_text(
            frame,
            self.fonts.medium,
            f"{self.state.lap}/3",
            (84, flag_y),
            WHITE,
            INK,
            3,
            "midleft",
        )

        # Position badge.
        outlined_text(
            frame,
            self.fonts.place,
            "1",
            (WIDTH - 94, HEIGHT - 68),
            YELLOW,
            WHITE,
            7,
            "bottomright",
        )
        outlined_text(
            frame,
            self.fonts.medium,
            "ST",
            (WIDTH - 28, HEIGHT - 45),
            WHITE,
            INK,
            4,
            "bottomright",
        )

        if self.state.off_road:
            warning = pygame.Rect(0, 0, 170, 48)
            warning.midtop = (WIDTH // 2, 48)
            rounded_rect(frame, warning, (222, 75, 60), 24, 4, WHITE)
            outlined_text(
                frame,
                self.fonts.tiny,
                "!  OFF ROAD",
                warning.center,
                WHITE,
                INK,
                2,
                "center",
            )

    def draw_countdown(self) -> None:
        elapsed = self.state.elapsed
        if elapsed >= 3.75:
            if elapsed < self.state.final_lap_until:
                text = "FINAL LAP"
            else:
                return
        elif elapsed < 1.0:
            text = "3"
        elif elapsed < 2.0:
            text = "2"
        elif elapsed < 3.0:
            text = "1"
        else:
            text = "GO!"
        color = YELLOW if text == "GO!" else WHITE
        outlined_text(
            self.frame,
            (
                self.fonts.large
                if text == "FINAL LAP"
                else self.fonts.countdown if text != "GO!" else self.fonts.place
            ),
            text,
            (WIDTH // 2, HEIGHT // 2 - 35),
            color,
            INK,
            8,
            "center",
        )

    def draw(self) -> None:
        self.draw_background()
        self.draw_road()
        self.draw_player_kart()
        self.draw_hud()
        self.draw_countdown()

        window_size = self.screen.get_size()
        if window_size == (WIDTH, HEIGHT):
            self.screen.blit(self.frame, (0, 0))
        else:
            scaled = pygame.transform.smoothscale(self.frame, window_size)
            self.screen.blit(scaled, (0, 0))
        pygame.display.flip()

    def run(self) -> None:
        while self.running:
            dt = min(self.clock.tick(FPS) / 1000.0, 1 / 30)
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    self.running = False
                elif event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                    self.running = False

            self.update(dt)
            self.draw()
            self.frames += 1
            if self.smoke_test and self.frames >= 5:
                self.running = False

        pygame.quit()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Pulse Circuit racer")
    parser.add_argument(
        "--smoke-test",
        action="store_true",
        help="render five headless-friendly frames and exit",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.smoke_test and "SDL_VIDEODRIVER" not in os.environ:
        os.environ["SDL_VIDEODRIVER"] = "dummy"
    PulseCircuit(smoke_test=args.smoke_test).run()


if __name__ == "__main__":
    main()
