import os
import unittest

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

from games.frontend.main import PulseCircuit, SteeringSample


class FixedInput:
    def __init__(self, steer: float) -> None:
        self.steer = steer

    def read(self, _dt: float) -> SteeringSample:
        return SteeringSample(self.steer)


class SteeringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.game = PulseCircuit(smoke_test=True)
        self.game.curve_at = lambda _distance: 0.0
        self.game.state.elapsed = 4.0
        self.game.state.speed = 900.0

    def tearDown(self) -> None:
        import pygame

        pygame.quit()

    def test_heading_requires_countersteering(self) -> None:
        self.game.input = FixedInput(-1.0)
        for _ in range(30):
            self.game.update(1 / 60)

        held_heading = self.game.state.heading
        lateral_before = self.game.state.lateral

        self.game.input = FixedInput(0.0)
        for _ in range(30):
            self.game.update(1 / 60)

        self.assertAlmostEqual(self.game.state.heading, held_heading)
        self.assertLess(self.game.state.lateral, lateral_before)

    def test_warning_waits_for_road_edge(self) -> None:
        self.game.state.lateral = 1.2
        self.game.input = FixedInput(0.0)
        self.game.update(1 / 60)

        self.assertFalse(self.game.state.off_road)


if __name__ == "__main__":
    unittest.main()
