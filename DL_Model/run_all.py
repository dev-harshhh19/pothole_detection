"""
run_all.py
==========
Master launcher for the DL Pothole Detection model pipeline.

Steps
-----
  1. Build dataset and train model (python train.py)
  2. Evaluate model (python evaluate.py)
  3. Run real-time adaptive detector demo (python adaptive_detector.py --demo)

Usage
-----
  # Full pipeline (train -> evaluate -> demo):
  python run_all.py

  # Skip training (model already exists):
  python run_all.py --skip-train

  # Train with adaptive 6-feature model:
  python run_all.py --adaptive
"""

import os
import sys
import argparse
import subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))


def _run(cmd: list, desc: str):
    print(f"\n{'='*65}")
    print(f"  [RUN] {desc}")
    print(f"{'='*65}\n")
    result = subprocess.run(cmd, cwd=HERE)
    if result.returncode != 0:
        print(f"\n  [ERROR] [{desc}] exited with code {result.returncode}")
        sys.exit(result.returncode)
    print(f"\n  [OK] [{desc}] done\n")


def main():
    p = argparse.ArgumentParser(description="DL Pothole Detection Model Pipeline")
    p.add_argument("--skip-train", action="store_true", help="Skip training (use existing model)")
    p.add_argument("--skip-eval", action="store_true", help="Skip evaluation step")
    p.add_argument("--demo-only", action="store_true", help="Run only the adaptive detector demo")
    p.add_argument("--adaptive", action="store_true", help="Train with 6-feature adaptive dataset")
    p.add_argument("--epochs", type=int, default=None, help="Override training epochs")
    p.add_argument("--port", default=None, help="Real LiDAR serial port (e.g. /dev/ttyUSB0 or COM3)")
    args = p.parse_args()

    py = sys.executable

    # Demo only
    if args.demo_only:
        cmd = [py, os.path.join(HERE, "adaptive_detector.py"), "--demo"]
        if args.port:
            cmd += ["--port", args.port]
        _run(cmd, "Adaptive Detector Demo")
        return

    # 1. Train
    from dl_config import MODEL_SAVE_PATH
    if not args.skip_train:
        train_cmd = [py, os.path.join(HERE, "train.py")]
        if args.adaptive:
            train_cmd.append("--adaptive")
        if args.epochs:
            train_cmd += ["--epochs", str(args.epochs)]
        _run(train_cmd, "Training DL Model")
    else:
        if not os.path.exists(MODEL_SAVE_PATH):
            print(f"  [ERROR] --skip-train set but no model found at {MODEL_SAVE_PATH}")
            print("  Run without --skip-train to train first.")
            sys.exit(1)
        print(f"\n  Skipping training (model found at {MODEL_SAVE_PATH})")

    # 2. Evaluate
    if not args.skip_eval:
        _run([py, os.path.join(HERE, "evaluate.py")], "Model Evaluation")

    # 3. Real-time demo
    demo_cmd = [py, os.path.join(HERE, "adaptive_detector.py"), "--demo", "--use-model"]
    if args.port:
        demo_cmd = [py, os.path.join(HERE, "adaptive_detector.py"), "--port", args.port, "--use-model"]
    _run(demo_cmd, "Real-Time Adaptive Demo")

    print("\n" + "="*65)
    print("  Pipeline complete.")
    print("  To launch the application UI, run:")
    print("     python server.py")
    print("="*65 + "\n")


if __name__ == "__main__":
    main()
