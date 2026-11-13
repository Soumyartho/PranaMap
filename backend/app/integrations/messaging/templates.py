"""Message templates. Indian commercial SMS must match a DLT-registered template exactly, with
variables as {#var#}; WhatsApp business messages must match an approved template. Each template
here carries both ids (fill them in from your DLT portal / WhatsApp Manager) and the text per
language. Variables are positional and kept free of clinical detail: a phone screen is not private.
"""

from __future__ import annotations

TEMPLATES: dict[str, dict] = {
    "appointment_reminder": {
        "vars": ["facility", "date", "asha"],
        "dlt_template_id": "",
        "whatsapp_template": "pranamap_appointment_reminder",
        "text": {
            "en": "PranaMap: Reminder of your health check at {#var#} on {#var#}. Your ASHA {#var#} can help. Free service.",
            "hi": "PranaMap: {#var#} पर {#var#} को आपकी स्वास्थ्य जांच है। आपकी आशा {#var#} मदद करेंगी। मुफ्त सेवा।",
            "bn": "PranaMap: {#var#}-এ {#var#} তারিখে আপনার স্বাস্থ্য পরীক্ষা। আপনার আশা {#var#} সাহায্য করবেন। বিনামূল্যে।",
        },
    },
    "teleconsult_reminder": {
        "vars": ["date", "asha"],
        "dlt_template_id": "",
        "whatsapp_template": "pranamap_teleconsult_reminder",
        "text": {
            "en": "PranaMap: Your call with the doctor is on {#var#}. Your ASHA {#var#} will help you join. Free service.",
            "hi": "PranaMap: डॉक्टर से आपकी कॉल {#var#} को है। आपकी आशा {#var#} जुड़ने में मदद करेंगी। मुफ्त सेवा।",
            "bn": "PranaMap: ডাক্তারের সাথে আপনার কল {#var#} তারিখে। আপনার আশা {#var#} যুক্ত হতে সাহায্য করবেন। বিনামূল্যে।",
        },
    },
    "missed_visit": {
        "vars": ["facility", "asha"],
        "dlt_template_id": "",
        "whatsapp_template": "pranamap_missed_visit",
        "text": {
            "en": "PranaMap: We missed you at {#var#}. Your ASHA {#var#} will visit to book a new time. Free service.",
            "hi": "PranaMap: आप {#var#} नहीं आ पाए। आपकी आशा {#var#} नया समय तय करने आएंगी। मुफ्त सेवा।",
            "bn": "PranaMap: আপনি {#var#}-এ আসতে পারেননি। আপনার আশা {#var#} নতুন সময় ঠিক করতে আসবেন। বিনামূল্যে।",
        },
    },
    "emergency_anm": {
        "vars": ["person", "asha", "house"],
        "dlt_template_id": "",
        "whatsapp_template": "pranamap_emergency_anm",
        "text": {
            "en": "PranaMap EMERGENCY: {#var#} flagged by ASHA {#var#} ({#var#}). 108 advised. Open PranaMap.",
            "hi": "PranaMap आपातकाल: {#var#}, आशा {#var#} द्वारा चिह्नित ({#var#})। 108 की सलाह दी गई। PranaMap खोलें।",
            "bn": "PranaMap জরুরি: {#var#}, আশা {#var#} চিহ্নিত করেছেন ({#var#})। 108-এর পরামর্শ। PranaMap খুলুন।",
        },
    },
}


def render(template: str, lang: str, values: dict[str, str]) -> tuple[str, list[str]]:
    """Fill {#var#} slots in the template's declared order. Returns the text and the ordered values
    (WhatsApp templates take them as a list). Raises on a missing value: a DLT mismatch is rejected."""
    spec = TEMPLATES[template]
    text = spec["text"].get(lang) or spec["text"]["en"]
    params = [values[name] for name in spec["vars"]]
    if text.count("{#var#}") != len(params):
        raise ValueError(f"template {template}/{lang} has {text.count('{#var#}')} slots, declares {len(params)}")
    for p in params:
        text = text.replace("{#var#}", p, 1)
    return text, params
