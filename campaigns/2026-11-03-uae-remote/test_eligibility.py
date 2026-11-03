import json
import unittest
from pathlib import Path
from eligibility import eligibility

POLICY = json.loads(Path(__file__).with_name("campaign.json").read_text())
BASE = {"public_slug":"rails-senior-1", "title":"Ruby on Rails Developer", "skills":["rails", "postgresql"]}

def job(**fields):
    return {**BASE, **fields}

class EligibilityTests(unittest.TestCase):
    def test_remote_worldwide(self):
        self.assertTrue(eligibility(job(work_mode="remote", regions=["global"], countries=[]), POLICY)[0])
    def test_remote_emea(self):
        self.assertTrue(eligibility(job(work_mode="remote", location="Remote EMEA"), POLICY)[0])
    def test_remote_mena(self):
        self.assertTrue(eligibility(job(work_mode="remote", regions=["mena"]), POLICY)[0])
    def test_remote_europe_only(self):
        self.assertFalse(eligibility(job(work_mode="remote", regions=["eu"], countries=["de","fr"]), POLICY)[0])
    def test_remote_us_only(self):
        self.assertFalse(eligibility(job(work_mode="remote", location="Remote US", countries=["us"]), POLICY)[0])
    def test_hybrid_uae(self):
        self.assertTrue(eligibility(job(work_mode="hybrid", countries=["ae"]), POLICY)[0])
    def test_hybrid_uae_location(self):
        self.assertTrue(eligibility(job(work_mode="hybrid", location="Dubai, United Arab Emirates"), POLICY)[0])
    def test_onsite_uk_rejected(self):
        self.assertFalse(eligibility(job(work_mode="onsite", countries=["gb"]), POLICY)[0])
    def test_unknown_mode_rejected(self):
        self.assertFalse(eligibility(job(work_mode="", location="Dubai"), POLICY)[0])
    def test_unsupported_skill_rejected(self):
        self.assertFalse(eligibility(job(work_mode="remote", regions=["global"], skills=["java","kotlin"]), POLICY)[0])
    def test_nontech_rejected(self):
        self.assertFalse(eligibility(job(work_mode="remote", regions=["global"], is_tech="non_tech"), POLICY)[0])
    def test_closed_rejected(self):
        self.assertFalse(eligibility(job(work_mode="remote", regions=["global"], closed_at="2026-11-01"), POLICY)[0])
    def test_missing_slug_rejected(self):
        self.assertFalse(eligibility(job(public_slug="", work_mode="remote", regions=["global"]), POLICY)[0])

if __name__ == "__main__": unittest.main()
