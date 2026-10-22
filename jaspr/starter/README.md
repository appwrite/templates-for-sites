# Jaspr Starter Kit with Appwrite

Kickstart your Jaspr development with this ready-to-use starter project integrated
with [Appwrite](https://appwrite.io).

This guide will help you quickly set up, customize, and build your Jaspr app.

---

## 🚀 Getting Started

### Clone the Project

Clone this repository to your local machine using Git:

```bash
git clone https://github.com/appwrite/templates-for-sites
cd templates-for-sites/jaspr/starter
```

### Prerequisites

- [Dart SDK](https://dart.dev/get-dart) 3.10 or later (also included with Flutter)
- The Jaspr CLI, installed with `dart pub global activate jaspr_cli`

---

## 🛠️ Development Guide

1. **Configure Appwrite**  
   Open `lib/config/environment.dart` and update the values with your Appwrite project credentials:
   ```dart
   class Environment {
     static const String appwritePublicEndpoint = '[appwritePublicEndpoint]';
     static const String appwriteProjectId = '[appwriteProjectId]';
     static const String appwriteProjectName = '[appwriteProjectName]';
   }
   ```

2. **Customize as Needed**  
   Modify the starter kit to suit your app's requirements. Adjust UI, features, or backend
   integrations as per your needs. The page lives in `lib/app.dart` and its styles in `web/styles.css`.

3. **Install Dependencies**  
   ```bash
   dart pub get
   ```

4. **Run the App**  
   Start the development server, then open `http://localhost:8080`:
   ```bash
   jaspr serve
   ```

---

## 📦 Building for Production

Build your project using `jaspr build`. The output will be located inside the `build/jaspr/` directory.
Start the production server with `./build/jaspr/app`, which listens on the port in `PORT` (default `8080`).

When deployed to Appwrite Sites, `prepare-env.sh` fills in `lib/config/environment.dart` from the
`APPWRITE_PUBLIC_ENDPOINT`, `APPWRITE_PROJECT_ID` and `APPWRITE_PROJECT_NAME` variables before the build.

---

## 💡 Additional Notes

- This starter project is designed to streamline your Jaspr development with Appwrite.
- It uses the [dart_appwrite](https://pub.dev/packages/dart_appwrite) SDK, which runs both on the server and in the browser.
- Refer to the [Appwrite Documentation](https://appwrite.io/docs) for detailed integration guidance.
