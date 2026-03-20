-- PREP: get_file_type_handlers
SELECT extension, extractor
FROM file_type_handlers
WHERE is_enabled = 1;
