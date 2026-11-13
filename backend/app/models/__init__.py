"""Database entities (the M in MVC). Views never touch these directly; controllers map them."""

from .care import Alert, Appointment, Media, Referral, ReferralEvent
from .clinical import Consent, Screening, SyndromeEvent
from .geo import Facility, Village
from .people import Household, Person, User
from .system import AuditLog, Notification, SyncEvent

__all__ = [
    "Alert",
    "Appointment",
    "AuditLog",
    "Consent",
    "Facility",
    "Household",
    "Media",
    "Notification",
    "Person",
    "Referral",
    "ReferralEvent",
    "Screening",
    "SyncEvent",
    "SyndromeEvent",
    "User",
    "Village",
]
