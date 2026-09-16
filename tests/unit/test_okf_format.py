import io
import stat
import zipfile

import pytest

from app.configuration.okf import OKFPolicy, eligibility, parse_bundle


def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path, raw in entries:
            bundle.writestr(path, raw)
    return output.getvalue()


def test_okf_unknown_metadata_verification_links_and_missing_optional_fields():
    raw = archive([
        ("index.md", "---\nokf_version: '0.2'\nproducer_extension: keep\n---\n# Source index"),
        ("log.md", "# History\n## 2026-09-15\nAdded references."),
        ("guide/a.md", "---\ntype: Novel Type\nverified: {by: 'human:upstream', at: 2026-09-15T10:00:00Z}\ncustom: {nested: [1, true, null]}\n---\n[A](/guide/b.md) [Missing](missing.md) [External](https://example.test/a)"),
        ("guide/b.md", "---\ntype: Reference\n---\n[B](a.md)"),
    ])
    concepts, navigation, diagnostics = parse_bundle("knowledge.zip", raw, OKFPolicy())
    assert len(concepts) == 2 and len(navigation) == 2
    assert concepts[0].metadata["custom"] == {"nested": [1, True, None]}
    assert concepts[0].metadata["verified"][0]["by"] == "human:upstream"
    assert concepts[0].links[0] == {"target": "/guide/b.md", "path": "guide/b.md", "resolved": True}
    assert concepts[1].links[0]["path"] == "guide/a.md"  # cycles remain harmless data
    assert [item.code for item in diagnostics] == ["unresolved_link"]
    minimal = parse_bundle("minimal.md", b"---\ntype: Unfamiliar\n---\n", OKFPolicy())[0][0]
    assert minimal.content == "" and minimal.title == "minimal"


@pytest.mark.parametrize("path", ["../outside.md", "/absolute.md", "a/../b.md", "a\\b.md", "C:/b.md", "a%2fb.md", "a//b.md"])
def test_okf_archive_rejects_unsafe_paths(path):
    with pytest.raises(ValueError):
        parse_bundle("bundle.zip", archive([(path, "---\ntype: Reference\n---\nText")]), OKFPolicy())


@pytest.mark.parametrize("metadata", [
    "type: Reference\na: &shared [1]\nb: *shared",
    "type: Reference\ntype: Other",
    "type: !!python/object/apply:os.system ['echo unsafe']",
    "type: Reference\nvalue: .nan",
    "type: Reference\nvalue: " + "[" * 30 + "1" + "]" * 30,
])
def test_okf_yaml_rejects_dangerous_or_excessive_structures(metadata):
    with pytest.raises(ValueError):
        parse_bundle("a.md", ("---\n" + metadata + "\n---\nText").encode(), OKFPolicy())


def test_okf_archive_collision_symlink_compression_and_limits():
    text = "---\ntype: Reference\n---\nText"
    with pytest.raises(ValueError, match="duplicate"):
        parse_bundle("bundle.zip", archive([("A.md", text), ("a.md", text)]), OKFPolicy())
    link = zipfile.ZipInfo("link.md")
    link.external_attr = (stat.S_IFLNK | 0o777) << 16
    with pytest.raises(ValueError, match="links"):
        parse_bundle("bundle.zip", archive([(link, "../../outside")]), OKFPolicy())
    with pytest.raises(ValueError, match="expansion"):
        parse_bundle("bundle.zip", archive([("large.md", text + "a" * 1000000)]), OKFPolicy())
    with pytest.raises(ValueError, match="entry count"):
        parse_bundle("bundle.zip", archive([("a.md", text), ("b.md", text)]), OKFPolicy(max_files=1))
    with pytest.raises(ValueError, match="Markdown"):
        parse_bundle("bundle.zip", archive([("run.py", "print('untrusted')")]), OKFPolicy())


def test_okf_freshness_is_explicit_and_does_not_invent_dates():
    now = 1800000000
    for invalid in [None, "2030-01-01", "2030-01-01T10:00:00", "invalid"]:
        decision = eligibility({"metadata": {"stale_after": invalid}}, OKFPolicy(), now)
        assert decision["eligible"] is True and decision["freshness"] == "unknown"
    assert eligibility({"metadata": {"stale_after": "2000-01-01T00:00:00Z"}}, OKFPolicy(), now)["reason"] == "source_stale"
    assert eligibility({"metadata": {"status": "deprecated"}}, OKFPolicy(), now)["reason"] == "source_deprecated"
    assert eligibility({"metadata": {"status": "draft"}}, OKFPolicy(), now)["reason"] == "source_draft"
