from dateutil.relativedelta import relativedelta
from datetime import timedelta


def next_payment(subscription, day):
    anchor = subscription.next_payment
    if anchor >= day:
        return anchor
    if subscription.period == "weekly":
        return anchor + timedelta(weeks=((day - anchor).days + 6) // 7)
    months = (day.year - anchor.year) * 12 + day.month - anchor.month
    if subscription.period == "yearly":
        months = (months // 12) * 12
    candidate = anchor + relativedelta(months=months)
    if candidate < day:
        candidate = anchor + relativedelta(months=months + (12 if subscription.period == "yearly" else 1))
    return candidate
