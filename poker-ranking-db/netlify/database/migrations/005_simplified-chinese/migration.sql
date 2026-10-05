-- Convert existing system-generated text to Simplified Chinese.
-- Player names and phone numbers are user data and are left untouched.

-- Default leaderboard title (only if it was never changed)
UPDATE settings SET value = '扑克积分排行榜'
 WHERE key = 'title' AND value = '撲克積分排行榜';

-- Reward options are fixed choices, so old Traditional values must match the new list
UPDATE sng_results SET reward = '20000积分' WHERE reward = '20000積分';
UPDATE sng_results SET reward = '10000积分' WHERE reward = '10000積分';
