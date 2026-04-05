-- PREP: upsert_scheme
INSERT OR REPLACE INTO schemes (name, fidelity, model_visible, valid_states, category)
VALUES (:name, :fidelity, :model_visible, :valid_states, :category);
