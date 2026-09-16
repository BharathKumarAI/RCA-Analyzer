-- Earlier audit entries did not record the source blob; leave those unknown.
ALTER TABLE governance.harness_bundle_audit ADD COLUMN blob_hash VARCHAR(128);
