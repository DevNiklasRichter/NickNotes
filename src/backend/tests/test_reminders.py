from __future__ import annotations

import unittest
from datetime import date, datetime, time

from src.backend.nicknotes_backend.reminders import (
    format_remind_at,
    normalize_remind_at,
    parse_capture_time,
    parse_remind_at,
    shift_remind_at,
)


class ReminderFieldTests(unittest.TestCase):
    def test_reminders_are_read_leniently_and_written_back_canonically(self) -> None:
        self.assertEqual(parse_remind_at("2026-11-21 09:00"), datetime(2026, 11, 21, 9, 0))
        self.assertEqual(normalize_remind_at("2026-11-21T9:05"), "2026-11-21 09:05")
        self.assertEqual(normalize_remind_at("2026-11-21T09:05:59"), "2026-11-21 09:05")
        self.assertEqual(normalize_remind_at(datetime(2026, 11, 21, 7, 30, 12)), "2026-11-21 07:30")
        self.assertEqual(format_remind_at(datetime(2030, 1, 2, 18, 0)), "2030-01-02 18:00")
        for raw in ("", None, "morgen", "2026-11-21", "2026-02-30 09:00", "2026-11-21 25:00", "2026-11-21 09:60"):
            self.assertIsNone(parse_remind_at(raw), raw)

    def test_next_instance_keeps_distance_to_the_due_day_and_time_of_day(self) -> None:
        self.assertEqual(shift_remind_at("2030-01-31 08:00", date(2030, 1, 31), date(2030, 2, 28)), "2030-02-28 08:00")
        # A day ahead of the due day stays a day ahead.
        self.assertEqual(shift_remind_at("2030-01-06 18:30", date(2030, 1, 7), date(2030, 1, 14)), "2030-01-13 18:30")
        # Without a previous due day: on the new due day.
        self.assertEqual(shift_remind_at("2029-12-01 09:00", None, date(2030, 1, 3)), "2030-01-03 09:00")
        self.assertIsNone(shift_remind_at("", date(2030, 1, 1), date(2030, 1, 2)))

    def test_capture_time_words(self) -> None:
        self.assertEqual(parse_capture_time("9:00"), time(9, 0))
        self.assertEqual(parse_capture_time("18:30"), time(18, 30))
        self.assertEqual(parse_capture_time("7Uhr"), time(7, 0))
        for word in ("9", "24:00", "9:60", "9:5", "neun", "uhr"):
            self.assertIsNone(parse_capture_time(word), word)


if __name__ == "__main__":
    unittest.main()
