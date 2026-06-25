from robojudo.config import cfg_registry
from robojudo.controller.ctrl_cfgs import (
    JoystickCtrlCfg,  # noqa: F401
    KeyboardCtrlCfg,  # noqa: F401
    McpRedisCtrlCfg,  # noqa: F401
    UnitreeCtrlCfg,  # noqa: F401
)
from robojudo.pipeline.pipeline_cfgs import (
    RlLocoMimicPipelineCfg,  # noqa: F401
    RlMultiPolicyPipelineCfg,  # noqa: F401
    RlPipelineCfg,  # noqa: F401
)

from .ctrl.g1_beyondmimic_ctrl_cfg import G1BeyondmimicCtrlCfg  # noqa: F401
from .ctrl.g1_motion_ctrl_cfg import (  # noqa: F401
    G1MotionCtrlCfg,
    G1MotionH2HCtrlCfg,
    G1MotionKungfuBotCtrlCfg,
    G1MotionTwistCtrlCfg,
)
from .ctrl.g1_twist_redis_ctrl_cfg import G1TwistRedisCtrlCfg  # noqa: F401
from .env.g1_dummy_env_cfg import G1DummyEnvCfg  # noqa: F401
from .env.g1_mujuco_env_cfg import G1_12MujocoEnvCfg, G1_23MujocoEnvCfg, G1MujocoEnvCfg  # noqa: F401
from .env.g1_real_env_cfg import G1RealEnvCfg, G1UnitreeCfg  # noqa: F401
from .pipeline.g1_locomimic_pipeline_cfg import G1RlLocoMimicPipelineCfg  # noqa: F401
from .policy.g1_amo_policy_cfg import G1AmoPolicyCfg  # noqa: F401
from .policy.g1_asap_policy_cfg import G1AsapLocoPolicyCfg, G1AsapPolicyCfg  # noqa: F401
from .policy.g1_beyondmimic_policy_cfg import G1BeyondMimicPolicyCfg  # noqa: F401
from .policy.g1_h2h_policy_cfg import G1H2HPolicyCfg  # noqa: F401
from .policy.g1_kungfubot_policy_cfg import G1KungfuBotGeneralPolicyCfg, G1KungfuBotPolicyCfg  # noqa: F401
from .policy.g1_smooth_policy_cfg import G1SmoothPolicyCfg  # noqa: F401
from .policy.g1_twist_policy_cfg import G1TwistPolicyCfg  # noqa: F401
from .policy.g1_unitree_policy_cfg import G1UnitreePolicyCfg, G1UnitreeWoGaitPolicyCfg  # noqa: F401

# ================= LocoMotion + MotionMimic Policy Switch Configs ================= #


@cfg_registry.register
class g1_locomimic_beyondmimic(G1RlLocoMimicPipelineCfg):
    """
    Smooth switch between multiple BeyondMimic policies, Sim2Sim.
    """

    robot: str = "g1"
    env: G1MujocoEnvCfg = G1MujocoEnvCfg()
    ctrl: list[KeyboardCtrlCfg | JoystickCtrlCfg] = [
        KeyboardCtrlCfg(
            triggers={
                "i": "[SIM_REBORN]",
                "o": "[SHUTDOWN]",
                "]": "[POLICY_LOCO]",
                "[": "[POLICY_MIMIC]",
                ";": "[POLICY_SWITCH],NEXT",
                "'": "[POLICY_SWITCH],LAST",
            }
        ),
        # JoystickCtrlCfg(
        #     combination_init_buttons=[],
        #     triggers={
        #         "A": "[SHUTDOWN]",
        #         "Back": "[POLICY_LOCO]",
        #         "Start": "[POLICY_MIMIC]",
        #         "RB": "[POLICY_SWITCH],NEXT",
        #         "LB": "[POLICY_SWITCH],LAST",
        #     },
        # ),
    ]

    loco_policy: G1AmoPolicyCfg = G1AmoPolicyCfg()
    # loco_policy: G1AsapLocoPolicyCfg = G1AsapLocoPolicyCfg()
    # loco_policy: G1UnitreePolicyCfg = G1UnitreePolicyCfg()
    # loco_policy: G1UnitreeWoGaitPolicyCfg = G1UnitreeWoGaitPolicyCfg()
    """Any LocoMotion policy, as init"""

    mimic_policies: list[G1BeyondMimicPolicyCfg] = [
        G1BeyondMimicPolicyCfg(policy_name="Dance_wose", without_state_estimator=True),
        G1BeyondMimicPolicyCfg(policy_name="Violin", without_state_estimator=False, max_timestep=500),
        G1BeyondMimicPolicyCfg(policy_name="Waltz", without_state_estimator=False, max_timestep=850),
    ]


@cfg_registry.register
class g1_moves(G1RlLocoMimicPipelineCfg):
    """
    BeyondMimic policy for custom move (video_033), Sim2Sim.
    Run with: python scripts/run_pipeline.py -c g1_moves
    """

    robot: str = "g1"
    env: G1MujocoEnvCfg = G1MujocoEnvCfg()
    ctrl: list[KeyboardCtrlCfg | JoystickCtrlCfg] = [
        KeyboardCtrlCfg(
            triggers={
                "i": "[SIM_REBORN]",
                "o": "[SHUTDOWN]",
                "]": "[POLICY_LOCO]",
                "p": "[POLICY_MIMIC]",
                "z": "[MOTION_FADE_IN]",
                "x": "[MOTION_FADE_OUT]",
                "c": "[MOTION_RESET]",
                ";": "[POLICY_SWITCH],LAST",
                "'": "[POLICY_SWITCH],NEXT",
            }
        ),
    ]

    loco_policy: G1AmoPolicyCfg = G1AmoPolicyCfg()
    """Any LocoMotion policy, as init"""

    mimic_policies: list[G1BeyondMimicPolicyCfg] = [
        G1BeyondMimicPolicyCfg(policy_name="video_033", without_state_estimator=False),
    ]


@cfg_registry.register
class g1_moves_two(G1RlLocoMimicPipelineCfg):
    """
    BeyondMimic policy switch for custom moves (video_017, video_025), Sim2Sim.
    Auto-plays video_017 then video_025 with no key presses required.
    Run with: python scripts/run_pipeline.py -c g1_moves_two
    """

    robot: str = "g1"
    env: G1MujocoEnvCfg = G1MujocoEnvCfg()
    ctrl: list[KeyboardCtrlCfg | JoystickCtrlCfg] = [
        KeyboardCtrlCfg(
            triggers={
                "i": "[SIM_REBORN]",
                "o": "[SHUTDOWN]",
                "]": "[POLICY_LOCO]",
                "p": "[POLICY_MIMIC]",
                "z": "[MOTION_FADE_IN]",
                "x": "[MOTION_FADE_OUT]",
                "c": "[MOTION_RESET]",
                ";": "[POLICY_SWITCH],LAST",
                "'": "[POLICY_SWITCH],NEXT",
            }
        ),
    ]

    loco_policy: G1AmoPolicyCfg = G1AmoPolicyCfg()
    """Any LocoMotion policy, as init"""

    # NOTE: max_timestep is the motion length in policy steps (~50 Hz).
    # Tune these to match the actual length of each clip.
    mimic_policies: list[G1BeyondMimicPolicyCfg] = [
        G1BeyondMimicPolicyCfg(policy_name="video_017", without_state_estimator=False, max_timestep=370),
        G1BeyondMimicPolicyCfg(policy_name="video_025", without_state_estimator=False, max_timestep=350),
    ]

    auto_play_mimic: bool = True
    auto_play_start_delay_steps: int = 100  # ~2 s of loco before the first clip
    auto_play_between_delay_steps: int = 75  # ~1.5 s of loco between clips
    auto_play_loop: bool = False


# ================= MCP-controlled pipeline (LLM orchestration) ================= #


# Per-motion overrides for autodiscovery. Add an entry here whenever you drop a
# new .onnx into assets/models/g1/beyondmimic/ that needs non-default values.
# Fields: (without_state_estimator, max_timestep)
#   - without_state_estimator: True for models trained without lin-vel/anchor-pos
#     obs (typically `*_wose` suffix). Wrong value → 154 vs 160 obs mismatch.
#   - max_timestep: motion length in policy steps (~50 Hz). Too high → clip loops.
_BEYONDMIMIC_OVERRIDES: dict[str, tuple[bool, int]] = {
    "Dance_wose": (True, 400),
    "Jump_wose":  (True, 400),
    "Violin":     (False, 500),
    "Waltz":      (False, 850),
    "video_017":  (False, 370),
    "video_025":  (False, 350),
    "video_033":  (False, 400),
}


def _discover_beyondmimic_motions() -> list["G1BeyondMimicPolicyCfg"]:
    """Scan assets/models/g1/beyondmimic/*.onnx and return a policy cfg per file.
    The MCP server reads the same directory so the tool list stays in sync.
    Index in this list == argument passed to '[POLICY_SWITCH],<idx>'."""
    from pathlib import Path

    from robojudo.config import ASSETS_DIR

    motion_dir = Path(ASSETS_DIR) / "models/g1/beyondmimic"
    if not motion_dir.is_dir():
        return []
    # Deterministic order so [POLICY_SWITCH],N is stable across restarts.
    names = sorted(p.stem for p in motion_dir.glob("*.onnx"))
    out: list[G1BeyondMimicPolicyCfg] = []
    for name in names:
        without_se, max_ts = _BEYONDMIMIC_OVERRIDES.get(
            name,
            # Fallback heuristic: '*_wose' suffix means without state estimator.
            (name.endswith("_wose"), 400),
        )
        out.append(
            G1BeyondMimicPolicyCfg(
                policy_name=name,
                without_state_estimator=without_se,
                max_timestep=max_ts,
            )
        )
    return out


@cfg_registry.register
class g1_mcp(G1RlLocoMimicPipelineCfg):
    """LLM/MCP-orchestrated pipeline. The MCP server pushes commands via Redis;
    the McpRedisCtrl controller injects them into the existing command bus.
    Loco policy is always running as the safe idle state — there is no dead
    time between motions.

    Bring-up:
        1. Start redis:   sudo systemctl start redis  (or `docker run -p 6379:6379 redis`)
        2. Start pipeline: python scripts/run_pipeline.py -c g1_mcp
        3. Start MCP server: python mcp_server/server.py
        4. Point your MCP client (Claude Desktop, etc.) at the server.
    """

    robot: str = "g1"
    env: G1MujocoEnvCfg = G1MujocoEnvCfg()
    ctrl: list[KeyboardCtrlCfg | JoystickCtrlCfg | McpRedisCtrlCfg] = [
        McpRedisCtrlCfg(),
        # Keep the keyboard available as a manual override / kill switch.
        KeyboardCtrlCfg(
            triggers={
                "o": "[SHUTDOWN]",
                "i": "[SIM_REBORN]",
                "]": "[POLICY_LOCO]",
            }
        ),
    ]

    loco_policy: G1AmoPolicyCfg = G1AmoPolicyCfg()
    """LocoMotion policy. Always active when no mimic is playing."""

    mimic_policies: list[G1BeyondMimicPolicyCfg] = _discover_beyondmimic_motions()

    # Auto-play OFF: the MCP server drives the sequencing.
    auto_play_mimic: bool = False


@cfg_registry.register
class g1_locomimic_asap(G1RlLocoMimicPipelineCfg):
    """
    Unitree G1 robot configuration, ASAP Locomotion + Deepmimic, Sim2Sim.
    Dynamic switch, keyboard control.
    """

    robot: str = "g1"
    env: G1MujocoEnvCfg = G1MujocoEnvCfg(forward_kinematic=None, update_with_fk=False, born_place_align=True)

    ctrl: list[KeyboardCtrlCfg | JoystickCtrlCfg] = [  # note: the ranking of controllers matters
        KeyboardCtrlCfg(
            triggers={
                "i": "[SIM_REBORN]",
                "o": "[SHUTDOWN]",
                "]": "[POLICY_LOCO]",
                "[": "[POLICY_MIMIC]",
                ";": "[POLICY_SWITCH],NEXT",
                "'": "[POLICY_SWITCH],LAST",
            }
        ),
        # JoystickCtrlCfg(
        #     combination_init_buttons=[],
        #     triggers={
        #         "A": "[SHUTDOWN]",
        #         "Back": "[POLICY_LOCO]",
        #         "Start": "[POLICY_MIMIC]",
        #         "RB": "[POLICY_SWITCH],NEXT",
        #         "LB": "[POLICY_SWITCH],LAST",
        #     },
        # ),
    ]

    loco_policy: G1AsapLocoPolicyCfg = G1AsapLocoPolicyCfg()

    # fmt: off
    mimic_policies: list[G1AsapPolicyCfg] = [
        G1AsapPolicyCfg(), # default CR7_level1
        G1AsapPolicyCfg(
            policy_name="robomimic",
            relative_path="dance_0605.onnx",
            motion_length_s=18.0,
            start_upper_body_dof_pos = [
                0, 0, 0,
                0.35, 0.18, 0, 0.87, 
                0.35, -0.18, 0, 0.87,
            ],
        ),
        G1KungfuBotPolicyCfg(),
    ]
    # fmt: on


# ================= LocoMimic Policy Switch Sim2real Configs ================= #


@cfg_registry.register
class g1_locomimic_beyondmimic_real(g1_locomimic_beyondmimic):
    """
    Locomotion + Beyondmimic, Sim2Real.
    Warning: Make sure the policy is stable for real robot before using it.
    """

    env: G1RealEnvCfg = G1RealEnvCfg(
        unitree=G1UnitreeCfg(
            net_if="eth0",  # note: change to your network interface
        ),
    )
    ctrl: list[UnitreeCtrlCfg] = [
        UnitreeCtrlCfg(
            combination_init_buttons=[],
            triggers={
                "A": "[SHUTDOWN]",
                "Select": "[POLICY_LOCO]",
                "Start": "[POLICY_MIMIC]",
                "R1": "[POLICY_SWITCH],NEXT",
                "L1": "[POLICY_SWITCH],LAST",
            },
        ),
    ]

    do_safety_check: bool = True  # enable safety check for real robot


@cfg_registry.register
class g1_moves_real(g1_moves):
    """
    BeyondMimic policy for custom move (video_033), Sim2Real.
    Run with: python scripts/run_pipeline.py -c g1_moves_real
    Warning: Make sure the policy is stable for real robot before using it.
    """

    env: G1RealEnvCfg = G1RealEnvCfg(
        unitree=G1UnitreeCfg(
            net_if="enp0s31f6",  # note: change to your network interface
        ),
    )
    ctrl: list[UnitreeCtrlCfg] = [
        UnitreeCtrlCfg(
            combination_init_buttons=[],
            triggers={
                "A": "[SHUTDOWN]",
                "Select": "[POLICY_LOCO]",
                "Start": "[POLICY_MIMIC]",
                "R1": "[POLICY_SWITCH],NEXT",
                "L1": "[POLICY_SWITCH],LAST",
            },
        ),
    ]

    do_safety_check: bool = True  # enable safety check for real robot


@cfg_registry.register
class g1_mcp_real(g1_mcp):
    """MCP/LLM-orchestrated pipeline, Sim2Real.

    Bring-up:
        1. sudo systemctl start redis
        2. python scripts/run_pipeline.py -c g1_mcp_real
           → Pipeline runs the standard 3-phase prepare (~8 s):
             Phase 1 (3 s): smooth ramp from current pose to default standing
             Phase 2 (5 s): blend in loco policy output
             Phase 3: hold default pose, wait for R press
           → You will see arms move into default pose (same as g1_moves_real).
        3. When the log says "prepare done — holding default pose, press R",
           press R on the Unitree remote → policy takes over, robot stands.
        4. (in another shell) python mcp_server/test_client.py play video_017

    Joystick buttons:
        R      → [MOTION_RESET]   release prep, hand control to policy (= arm)
        Select → [POLICY_LOCO]    force back to loco standing (panic)
        Start  → [ARM]            re-enable env after [DISARM]   (software gate)
        Back   → [DISARM]         freeze motor commands           (software gate)
        A      → [SHUTDOWN]       full stop

    Warning: validate every motion individually on real before chaining.
    """

    env: G1RealEnvCfg = G1RealEnvCfg(
        unitree=G1UnitreeCfg(
            net_if="enp0s31f6",  # match g1_moves_real; change if your iface differs
        ),
    )

    ctrl: list[McpRedisCtrlCfg | UnitreeCtrlCfg] = [
        McpRedisCtrlCfg(),
        UnitreeCtrlCfg(
            combination_init_buttons=[],
            triggers={
                "A": "[SHUTDOWN]",
                "Select": "[POLICY_LOCO]",
                "Start": "[ARM]",
                "Back": "[DISARM]",
            },
        ),
    ]

    do_safety_check: bool = True  # enable safety check for real robot


@cfg_registry.register
class g1_locomimic_asap_real(g1_locomimic_asap):
    """python scripts/run_pipeline.py -c g1_moves
    ASAP Locomotion + Deepmimic, Sim2Real.
    Warning: Make sure the policy is stable for real robot before using it.
    """

    # env: G1DummyEnvCfg = G1DummyEnvCfg()
    env: G1RealEnvCfg = G1RealEnvCfg(
        unitree=G1UnitreeCfg(
            net_if="eth0",  # note: change to your network interface
        ),
    )

    ctrl: list[UnitreeCtrlCfg] = [
        UnitreeCtrlCfg(
            combination_init_buttons=[],
            triggers={
                "A": "[SHUTDOWN]",
                "Select": "[POLICY_LOCO]",
                "Start": "[POLICY_MIMIC]",
                "R1": "[POLICY_SWITCH],NEXT",
                "L1": "[POLICY_SWITCH],LAST",
            },
        ),
    ]

    do_safety_check: bool = True  # enable safety check for real robot


# ================= ASAP Policy  ================= #
@cfg_registry.register
class g1_locomimic_asap_full(G1RlLocoMimicPipelineCfg):
    """
    Exact reproduce of the original ASAP code.
    You need to download the model files from the official repo and put them in assets/models/g1/asap
    """

    robot: str = "g1"
    env: G1MujocoEnvCfg = G1MujocoEnvCfg(forward_kinematic=None, update_with_fk=False, born_place_align=True)

    ctrl: list[KeyboardCtrlCfg | JoystickCtrlCfg] = [  # note: the ranking of controllers matters
        KeyboardCtrlCfg(
            triggers={
                "i": "[SIM_REBORN]",
                "o": "[SHUTDOWN]",
                "]": "[POLICY_LOCO]",
                "[": "[POLICY_MIMIC]",
                ";": "[POLICY_SWITCH],NEXT",
                "'": "[POLICY_SWITCH],LAST",
            }
        ),
    ]

    loco_policy: G1AsapLocoPolicyCfg = G1AsapLocoPolicyCfg()

    mimic_policies: list[G1AsapPolicyCfg] = []

    def __init__(self, **data) -> None:
        super().__init__(**data)
        # add all the asap policies in asap.yaml
        from pathlib import Path

        import yaml

        asap_config = yaml.safe_load(open(Path(__file__).parent / "asap.yaml"))
        for plicy_name, relative_path in asap_config["mimic_models"].items():
            start_upper_body_dof_pos = asap_config["start_upper_body_dof_pos"].get(plicy_name, None)
            # remove some joints that are not in the g1 23-dof model
            if start_upper_body_dof_pos is not None:
                start_upper_body_dof_pos = [start_upper_body_dof_pos[i] for i in [0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 13]]
            motion_length_s = asap_config["motion_length_s"].get(plicy_name, 10.0)
            self.mimic_policies.append(
                G1AsapPolicyCfg(
                    policy_name=plicy_name,
                    relative_path=relative_path,
                    start_upper_body_dof_pos=start_upper_body_dof_pos,
                    motion_length_s=motion_length_s,
                )
            )
