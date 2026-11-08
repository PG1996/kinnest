"""Server-written text (push notifications). Every string is keyed so another language is a new table."""

MESSAGES: dict[str, dict[str, dict[str, str]]] = {
    "en": {
        "feed_due": {
            "title": "{kid}: feed due",
            "body": "Last fed by {name} at {time}.",
        },
        "feed_due_again": {
            "title": "{kid}: still no feed logged",
            "body": "Due since {due}. Please feed {kid} and log it.",
        },
        "feed_overdue_admin": {
            "title": "{kid}: feed overdue {mins} min",
            "body": "Nobody has logged a feed since {time}. Please check.",
        },
        "med_due": {
            "title": "{kid}: {medicine} due",
            "body": "{dose} at {time}.{progress}",
        },
        "med_due_again": {
            "title": "{kid}: {medicine} still not given",
            "body": "Due since {time}.{progress} Please give it and tick it off.",
        },
        "med_overdue_admin": {
            "title": "{kid}: {medicine} overdue {mins} min",
            "body": "Nobody has marked the {time} dose.{progress} Please check.",
        },
        "med_nudge": {
            "title": "{kid}: {medicine} still to give",
            "body": "{left} left of {dose}.",
        },
        "diaper_alert": {
            "title": "{kid}: diaper check",
            "body": "No diaper logged since {time}.",
        },
    }
}


def render(key: str, params: dict, lang: str = "en") -> tuple[str, str]:
    msg = MESSAGES[lang][key]
    return msg["title"].format(**params), msg["body"].format(**params)
