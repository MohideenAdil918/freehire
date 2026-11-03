"""Strict geography and relevance gate for the FreeHire application campaign.

Only affirmative evidence that the candidate can work from the UAE passes.
An EMEA listing is eligible; a Europe-only or US-only remote listing is not.
"""
from __future__ import annotations

import re
from typing import Any

_UAE_PLACES = re.compile(
    r"\b(?:UAE|United Arab Emirates|Dubai|Abu Dhabi|Sharjah|Ajman|"
    r"Ras Al Khaimah|Fujairah|Al Ain|Umm Al Quwain)\b", re.I
)


def _strings(value: Any) -> set[str]:
    return {str(x).strip().lower().replace("_", "-") for x in value if x is not None} if isinstance(value, list) else set()


def eligibility(job: dict[str, Any], policy: dict[str, Any]) -> tuple[bool, str]:
    if not job.get("public_slug"):
        return False, "missing job identifier"
    if job.get("closed_at"):
        return False, "posting is closed"
    if job.get("is_tech") == "non_tech":
        return False, "not a technical vacancy"
    mode = str(job.get("work_mode") or "").strip().lower()
    location = str(job.get("location") or "").lower()
    regions = _strings(job.get("regions"))
    countries = _strings(job.get("countries"))
    uae = policy["uae_country_code"].lower()

    if mode == "remote":
        allowed_regions = set(policy["remote_allowed_regions"])
        phrases = policy["remote_location_phrases"]
        # Explicit country restrictions take precedence over broad prose such as
        # "worldwide" in the location field; do not assume work authorization.
        if countries and uae not in countries:
            return False, "remote role excludes UAE"
        if not (uae in countries or regions & allowed_regions or
                any(re.search(r"\b" + re.escape(p) + r"\b", location) for p in phrases)):
            return False, "remote location not demonstrably available from UAE"
    elif mode in {"onsite", "hybrid"}:
        if countries and uae not in countries:
            return False, "onsite/hybrid role outside UAE"
        if uae not in countries and not _UAE_PLACES.search(location):
            return False, "onsite/hybrid UAE location not confirmed"
    else:
        return False, "unknown work mode"

    title = str(job.get("title") or "")
    if not re.search(policy["role_title_pattern"], title):
        return False, "not a matching engineering role"
    claimed = set(policy["core_skills"])
    skills = _strings(job.get("skills"))
    overlap = skills & claimed
    # Ruby/Rails relevance is strong even if other skills were not tagged.
    if len(overlap) < policy["minimum_skill_overlap"] and not (overlap & {"ruby", "rails"}):
        return False, "insufficient verified skills overlap"
    return True, "eligible for detailed CV/requirement screening"
