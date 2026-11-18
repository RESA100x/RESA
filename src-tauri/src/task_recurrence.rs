//! Recurrence math for tasks.
//!
//! Tasks are materialised one row per occurrence: completing a recurring task
//! writes the next occurrence. That keeps the matrix, kanban board and status
//! island untouched (they only ever see plain tasks) and makes history visible.
//! `due_date` is the series anchor, so the next date is always derived from the
//! date the user actually completed, not from the wall clock.

use crate::error::CommandError;
use crate::recurrence::{weekday_from_code, Freq, Recurrence, RecurrenceEnd};
use chrono::{Datelike, Duration, NaiveDate, Weekday};

/// Rules are stored as JSON so the schema stays flat; unknown or corrupt JSON
/// reads as "no recurrence" instead of failing the whole task list.
pub fn rule_from_json(raw: &str) -> Option<Recurrence> {
    serde_json::from_str(raw).ok()
}

pub fn rule_to_json(rule: &Recurrence) -> Option<String> {
    serde_json::to_string(rule).ok()
}

fn weekday_codes(rule: &Recurrence) -> Result<Vec<Weekday>, CommandError> {
    rule.by_day
        .iter()
        .map(|code| weekday_from_code(code))
        .collect()
}

/// Rejects rules that would never produce a sensible next date.
pub fn validate(rule: &Recurrence) -> Result<(), CommandError> {
    if rule.interval < 1 {
        return Err(CommandError::validation(
            "recurrence",
            "重复间隔必须大于等于 1。",
        ));
    }
    if rule.freq == Freq::Weekly && rule.by_day.is_empty() {
        return Err(CommandError::validation(
            "recurrence",
            "每周重复至少要选择一天。",
        ));
    }
    weekday_codes(rule)?;
    match &rule.end {
        RecurrenceEnd::Never => Ok(()),
        RecurrenceEnd::Until { date } => {
            NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .map(|_| ())
                .map_err(|_| CommandError::validation("recurrence", "结束日期格式无效。"))
        }
        RecurrenceEnd::Count { count } => {
            if *count < 1 {
                return Err(CommandError::validation(
                    "recurrence",
                    "重复次数必须大于等于 1。",
                ));
            }
            Ok(())
        }
    }
}

fn week_start(date: NaiveDate) -> NaiveDate {
    date - Duration::days(i64::from(date.weekday().num_days_from_monday()))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_next = NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .expect("first day of a month always exists");
    (first_next - Duration::days(1)).day()
}

/// Adds calendar months, clamping to the last day so 31 Jan + 1 month is
/// 28/29 Feb rather than skipping the month entirely.
fn add_months_clamped(date: NaiveDate, months: i64) -> Option<NaiveDate> {
    let total = i64::from(date.year()) * 12 + i64::from(date.month0()) + months;
    let year = i32::try_from(total.div_euclid(12)).ok()?;
    let month0 = u32::try_from(total.rem_euclid(12)).ok()?;
    let day = date.day().min(days_in_month(year, month0 + 1));
    NaiveDate::from_ymd_opt(year, month0 + 1, day)
}

fn add_years_clamped(date: NaiveDate, years: i64) -> Option<NaiveDate> {
    let year = i32::try_from(i64::from(date.year()) + years).ok()?;
    let day = date.day().min(days_in_month(year, date.month()));
    NaiveDate::from_ymd_opt(year, date.month(), day)
}

fn next_candidate(rule: &Recurrence, anchor: NaiveDate, current: NaiveDate) -> Option<NaiveDate> {
    let interval = i64::from(rule.interval);
    match rule.freq {
        Freq::Daily => Some(current + Duration::days(interval)),
        Freq::Weekly => {
            let days = weekday_codes(rule).ok()?;
            if days.is_empty() {
                return Some(current + Duration::days(7 * interval));
            }
            let anchor_week = week_start(anchor);
            let mut candidate = current + Duration::days(1);
            // A full stride plus one week always contains a qualifying day.
            let limit = 7 * interval + 7;
            for _ in 0..limit {
                let weeks = (week_start(candidate) - anchor_week).num_days() / 7;
                if weeks >= 0 && weeks % interval == 0 && days.contains(&candidate.weekday()) {
                    return Some(candidate);
                }
                candidate += Duration::days(1);
            }
            None
        }
        Freq::Monthly => add_months_clamped(current, interval),
        Freq::Yearly => add_years_clamped(current, interval),
    }
}

/// The next due date for a series, or `None` once the rule has ended.
///
/// `occurrences` counts the rows already materialised for the series (the
/// occurrence being completed included), which is what `Count` compares to.
pub fn next_due_date(
    rule: &Recurrence,
    anchor: NaiveDate,
    current: NaiveDate,
    occurrences: u32,
) -> Option<NaiveDate> {
    let next = next_candidate(rule, anchor, current)?;
    if next <= current {
        return None;
    }
    match &rule.end {
        RecurrenceEnd::Never => Some(next),
        RecurrenceEnd::Until { date } => {
            let until = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
            (next <= until).then_some(next)
        }
        RecurrenceEnd::Count { count } => (occurrences < *count).then_some(next),
    }
}

#[cfg(test)]
mod tests {
    use super::{next_due_date, validate};
    use crate::recurrence::{Freq, Recurrence, RecurrenceEnd};

    fn rule(freq: Freq, interval: u32, by_day: &[&str], end: RecurrenceEnd) -> Recurrence {
        Recurrence {
            freq,
            interval,
            by_day: by_day.iter().map(|day| (*day).to_owned()).collect(),
            end,
        }
    }

    fn date(value: &str) -> chrono::NaiveDate {
        chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn daily_steps_by_interval() {
        let rule = rule(Freq::Daily, 2, &[], RecurrenceEnd::Never);
        let anchor = date("2026-03-01");
        assert_eq!(
            next_due_date(&rule, anchor, anchor, 1),
            Some(date("2026-03-03"))
        );
    }

    #[test]
    fn weekly_without_days_steps_one_week() {
        let rule = rule(Freq::Weekly, 1, &[], RecurrenceEnd::Never);
        let anchor = date("2026-03-02");
        assert_eq!(
            next_due_date(&rule, anchor, anchor, 1),
            Some(date("2026-03-09"))
        );
    }

    #[test]
    fn weekly_picks_the_next_selected_weekday() {
        // Anchor Monday 2026-03-02, repeat Mon/Wed/Fri.
        let rule = rule(Freq::Weekly, 1, &["MO", "WE", "FR"], RecurrenceEnd::Never);
        let anchor = date("2026-03-02");
        assert_eq!(
            next_due_date(&rule, anchor, anchor, 1),
            Some(date("2026-03-04"))
        );
        assert_eq!(
            next_due_date(&rule, anchor, date("2026-03-06"), 3),
            Some(date("2026-03-09"))
        );
    }

    #[test]
    fn weekly_honours_the_interval_stride() {
        // Every other week on Monday: 2026-03-02, 2026-03-16, ...
        let rule = rule(Freq::Weekly, 2, &["MO"], RecurrenceEnd::Never);
        let anchor = date("2026-03-02");
        assert_eq!(
            next_due_date(&rule, anchor, anchor, 1),
            Some(date("2026-03-16"))
        );
        assert_eq!(
            next_due_date(&rule, anchor, date("2026-03-16"), 2),
            Some(date("2026-03-30"))
        );
    }

    #[test]
    fn monthly_clamps_to_the_last_day() {
        let rule = rule(Freq::Monthly, 1, &[], RecurrenceEnd::Never);
        assert_eq!(
            next_due_date(&rule, date("2026-01-31"), date("2026-01-31"), 1),
            Some(date("2026-02-28"))
        );
        assert_eq!(
            next_due_date(&rule, date("2026-01-31"), date("2026-02-28"), 2),
            Some(date("2026-03-28"))
        );
    }

    #[test]
    fn yearly_clamps_leap_day() {
        let rule = rule(Freq::Yearly, 1, &[], RecurrenceEnd::Never);
        assert_eq!(
            next_due_date(&rule, date("2028-02-29"), date("2028-02-29"), 1),
            Some(date("2029-02-28"))
        );
    }

    #[test]
    fn until_stops_the_series() {
        let rule = rule(
            Freq::Daily,
            1,
            &[],
            RecurrenceEnd::Until {
                date: "2026-03-03".into(),
            },
        );
        let anchor = date("2026-03-01");
        assert_eq!(
            next_due_date(&rule, anchor, anchor, 1),
            Some(date("2026-03-02"))
        );
        assert_eq!(next_due_date(&rule, anchor, date("2026-03-03"), 3), None);
    }

    #[test]
    fn count_stops_the_series() {
        let rule = rule(Freq::Daily, 1, &[], RecurrenceEnd::Count { count: 3 });
        let anchor = date("2026-03-01");
        assert_eq!(
            next_due_date(&rule, anchor, date("2026-03-02"), 2),
            Some(date("2026-03-03"))
        );
        assert_eq!(next_due_date(&rule, anchor, date("2026-03-03"), 3), None);
    }

    #[test]
    fn validate_rejects_bad_rules() {
        assert!(validate(&rule(Freq::Daily, 0, &[], RecurrenceEnd::Never)).is_err());
        assert!(validate(&rule(Freq::Weekly, 1, &[], RecurrenceEnd::Never)).is_err());
        assert!(validate(&rule(Freq::Daily, 1, &[], RecurrenceEnd::Count { count: 0 })).is_err());
        assert!(validate(&rule(Freq::Daily, 1, &["XX"], RecurrenceEnd::Never)).is_err());
        assert!(validate(&rule(Freq::Daily, 1, &[], RecurrenceEnd::Never)).is_ok());
    }
}
