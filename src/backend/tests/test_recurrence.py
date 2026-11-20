from __future__ import annotations

import unittest
from datetime import date

from src.backend.nicknotes_backend.recurrence import (
    RepeatRule,
    add_months,
    first_occurrence,
    format_repeat,
    next_occurrence,
    parse_capture_repeat,
    parse_repeat,
)


class RecurrenceRuleTests(unittest.TestCase):
    def test_rules_are_parsed_and_written_back_canonically(self) -> None:
        self.assertEqual(parse_repeat("weekly"), RepeatRule("week", 1))
        self.assertEqual(parse_repeat(" Every  3 Days "), RepeatRule("day", 3))
        self.assertEqual(parse_repeat("every 1 month"), RepeatRule("month", 1))
        self.assertEqual(format_repeat(RepeatRule("month", 1)), "monthly")
        self.assertEqual(format_repeat(RepeatRule("week", 2)), "every 2 weeks")
        for raw in ("", None, "sometimes", "every 0 days", "every 400 days", "every 2 weekdays"):
            self.assertIsNone(parse_repeat(raw), raw)

    def test_month_ends_and_leap_years_are_clamped(self) -> None:
        self.assertEqual(add_months(date(2026, 1, 31), 1), date(2026, 2, 28))
        self.assertEqual(add_months(date(2028, 1, 31), 1), date(2028, 2, 29))
        self.assertEqual(add_months(date(2026, 12, 15), 1), date(2027, 1, 15))
        yearly = parse_repeat("yearly")
        self.assertEqual(next_occurrence(yearly, due=date(2028, 2, 29), completed=date(2028, 2, 29)), date(2029, 2, 28))

    def test_from_due_date_keeps_the_schedule_and_skips_missed_turns(self) -> None:
        weekly = parse_repeat("weekly")
        # Done early: the next one is a week after the due date.
        self.assertEqual(next_occurrence(weekly, due=date(2026, 11, 20), completed=date(2026, 11, 18)), date(2026, 11, 27))
        # Done three weeks late: back on the regular weekday after the completion, no pile-up.
        self.assertEqual(next_occurrence(weekly, due=date(2026, 11, 6), completed=date(2026, 11, 26)), date(2026, 11, 27))
        monthly = parse_repeat("monthly")
        # Counted from the original day, so 31 Jan does not drift to the 28th in later months.
        self.assertEqual(next_occurrence(monthly, due=date(2026, 1, 31), completed=date(2026, 3, 5)), date(2026, 3, 31))

    def test_from_completion_and_without_due_date(self) -> None:
        every_three = parse_repeat("every 3 days")
        self.assertEqual(next_occurrence(every_three, due=date(2026, 11, 1), completed=date(2026, 11, 20), from_completion=True), date(2026, 11, 23))
        self.assertEqual(next_occurrence(parse_repeat("weekly"), due=None, completed=date(2026, 11, 20)), date(2026, 11, 27))

    def test_weekdays_skip_the_weekend(self) -> None:
        weekdays = parse_repeat("weekdays")
        # 2026-11-20 is a Friday.
        self.assertEqual(next_occurrence(weekdays, due=date(2026, 11, 20), completed=date(2026, 11, 20)), date(2026, 11, 23))
        self.assertEqual(next_occurrence(weekdays, due=date(2026, 11, 17), completed=date(2026, 11, 17)), date(2026, 11, 18))


    def test_capture_words_name_a_rule(self) -> None:
        self.assertEqual(parse_capture_repeat("wöchentlich"), RepeatRule("week", 1))
        self.assertEqual(parse_capture_repeat("Woechentlich"), RepeatRule("week", 1))
        self.assertEqual(parse_capture_repeat("werktags"), RepeatRule("weekday", 1))
        self.assertEqual(parse_capture_repeat("vierteljährlich"), RepeatRule("month", 3))
        self.assertEqual(parse_capture_repeat("alle-10-tage"), RepeatRule("day", 10))
        self.assertEqual(parse_capture_repeat("alle-2-Wochen"), RepeatRule("week", 2))
        self.assertEqual(parse_capture_repeat("alle-1-monat"), RepeatRule("month", 1))
        for word in ("morgen", "2026-11-20", "alle-0-tage", "alle-400-tage", "alle-3-stunden", "weekly"):
            self.assertIsNone(parse_capture_repeat(word), word)

    def test_first_occurrence_of_a_captured_rule(self) -> None:
        # 2026-11-21 is a Saturday.
        self.assertEqual(first_occurrence(parse_repeat("weekdays"), date(2026, 11, 21)), date(2026, 11, 23))
        self.assertEqual(first_occurrence(parse_repeat("weekdays"), date(2026, 11, 20)), date(2026, 11, 20))
        self.assertEqual(first_occurrence(parse_repeat("weekly"), date(2026, 11, 21)), date(2026, 11, 21))


if __name__ == "__main__":
    unittest.main()
