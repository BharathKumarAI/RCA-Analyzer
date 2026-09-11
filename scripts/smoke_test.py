"""Offline smoke checks through the public API and native ADK Workflow runner."""

import unittest


def main():
    suite = unittest.defaultTestLoader.loadTestsFromNames(
        [
            "tests.harness.test_invariants.ApiTests",
            "tests.harness.test_approved_execution.ApprovedExecutionTests",
        ]
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    main()
