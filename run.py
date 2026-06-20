import os
import sys
import subprocess
import shutil
import time
import webbrowser

def check_command(cmd):
    return shutil.which(cmd) is not None

def print_step(msg):
    print("\n" + "="*60)
    print(f"👉 {msg}")
    print("="*60)

def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root_dir)

    print_step("Checking System Dependencies")
    print("✅ EasyOCR and PyTorch will be installed via Python pip package manager.")

    # 2. Install Python Dependencies
    print_step("Installing Python Backend Dependencies")
    requirements_path = os.path.join("backend", "requirements.txt")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", requirements_path], check=True)
        print("✅ Python dependencies installed successfully.")
    except subprocess.CalledProcessError:
        print("❌ Failed to install python dependencies. Please check your pip connection.")
        sys.exit(1)

    # 3. Check Node.js and NPM
    print_step("Checking Node.js & NPM")
    if not check_command("node") or not check_command("npm"):
        print("❌ Node.js and npm are required to build the frontend but were not found in PATH.")
        print("Please install Node.js from https://nodejs.org/")
        sys.exit(1)
    else:
        print("✅ Node.js and npm are available.")

    # 4. Build Frontend
    print_step("Installing Frontend Packages & Building Static Assets")
    frontend_dir = os.path.join(root_dir, "frontend")
    try:
        # Run npm install if node_modules doesn't exist or just run npm install
        print("Installing npm packages...")
        subprocess.run(["npm", "install"], cwd=frontend_dir, check=True)
        
        print("Building production static assets...")
        subprocess.run(["npm", "run", "build"], cwd=frontend_dir, check=True)
        print("✅ Frontend built successfully.")
    except subprocess.CalledProcessError:
        print("❌ Failed to build frontend static assets.")
        sys.exit(1)

    # 5. Start Backend Server
    print_step("Launching Flask Backend Server")
    backend_app = os.path.join(root_dir, "backend", "app.py")
    
    # Open browser after a brief delay
    def open_browser():
        time.sleep(2.0)
        print("\n🌐 Opening browser to http://localhost:5001 ...")
        webbrowser.open("http://localhost:5001")

    # Start browser thread
    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    # Start Flask (blocks execution)
    try:
        subprocess.run([sys.executable, backend_app], check=True)
    except KeyboardInterrupt:
        print("\n👋 Server shut down by user.")
    except subprocess.CalledProcessError as e:
        print(f"❌ Flask server crashed: {e}")

if __name__ == "__main__":
    main()
