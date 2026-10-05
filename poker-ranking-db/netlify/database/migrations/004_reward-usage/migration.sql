-- Track when a Sit and Go reward has been used (redeemed) and by which admin
ALTER TABLE sng_results ADD COLUMN reward_used_at TIMESTAMPTZ;
ALTER TABLE sng_results ADD COLUMN reward_used_by TEXT;
CREATE INDEX sng_results_reward_idx ON sng_results (reward) WHERE reward IS NOT NULL;
