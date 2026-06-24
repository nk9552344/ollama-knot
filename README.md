
 + uvicorn==0.49.0
(mcp_g1) arc2@ubuntu:~/vscode/ollama-knot/mcp_g1$ uv run python test_local.py 
# redis ping -> True

# list_policies()
[
  {
    "id": "walk_policy_unitree_g1",
    "name": "walking policy",
    "description": "This policy is used to walk the Unitree G1 robot. Takes some input parameters and produces a walking gait.\n"
  },
  {
    "id": "squats_policy_unitree_g1",
    "name": "squats policy",
    "description": "This policy makes the Unitree G1 robot perform squats.\n"
  }
]

# push_policy('walk_policy_unitree_g1')
{
  "status": "ok",
  "queued": [
    "walk_policy_unitree_g1"
  ],
  "queue": "policy_queue"
}

# push_policy_sequence(['walk_policy_unitree_g1', 'squats_policy_unitree_g1'])
{
  "status": "ok",
  "queued": [
    "walk_policy_unitree_g1",
    "squats_policy_unitree_g1"
  ],
  "queue": "policy_queue"
}

# push_policy('does_not_exist')  # should be rejected
{
  "status": "error",
  "message": "Unknown policy id: 'does_not_exist'",
  "known_ids": [
    "squats_policy_unitree_g1",
    "walk_policy_unitree_g1"
  ]
}

# queue contents (policy_queue)
[
  "walk_policy_unitree_g1",
  "walk_policy_unitree_g1",
  "squats_policy_unitree_g1"
]
(mcp_g1) arc2@ubuntu:~/vscode/ollama-knot/mcp_g1$ uv run python server.py 