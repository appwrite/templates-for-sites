# React-admin Demo With Appwrite

This is a demo of the [Appwrite](https://appwrite.io/) adapter for [react-admin](https://github.com/marmelab/react-admin), a frontend framework for building B2B applications on top of REST/GraphQL APIs.

## Features

- ⚡ A complete admin dashboard built with React-admin
- 💿 Backed by an [Appwrite](https://appwrite.io/) backend
- ⚙️ Automatic database, collection, and user seeding
- 🎨 Rich UI components from Material-UI

## Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v18 or higher recommended)
- npm or yarn
- An Appwrite project

## Quick Start

1. Clone the repository:
```bash
git clone https://github.com/marmelab/ra-appwrite.git
cd ra-appwrite/packages/demo
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Configure environment variables:
   - Create a `.env.local` file in the `packages/demo` directory.
   - Add the following environment variables to your `.env.local` file:
   ```env
   APPWRITE_SITE_API_ENDPOINT=https://cloud.appwrite.io/v1
   APPWRITE_SITE_PROJECT_ID=your_project_id_here
   APPWRITE_SITE_STANDARD_KEY=your_api_key_here
   ```
   > To create an API key, go to your Appwrite console, navigate to your project, then "API Keys". Create a new key with `users` and `databases` scopes.

4. Seed the database:
This command will create the necessary database, collections, and a demo user (`john.doe@marmelab.com`, password: `changeme`).
```bash
npm run db-seed
```

5. Start the development server:
```bash
npm run start
# or
yarn start
```

Your admin panel will be available at `http://localhost:8000`.

## Environment Variables

The following environment variables are required:

| Variable | Description | Example |
|----------|-------------|---------|
| APPWRITE_SITE_API_ENDPOINT | Your Appwrite project endpoint. | `https://cloud.appwrite.io/v1` |
| APPWRITE_SITE_PROJECT_ID | Your Appwrite project ID. | `60b8...` |
| APPWRITE_SITE_STANDARD_KEY | Your Appwrite project API key. | `a0b1...` |


## Project Structure

```
react-admin/
├── src/
│   ├── App.tsx          # Main application component
│   ├── dashboard/       # Dashboard components
│   ├── products/        # Product management views
│   ├── categories/      # Category management views
│   ├── visitors/        # Customer management views
│   ├── orders/          # Order management views
│   ├── invoices/        # Invoice management views
│   ├── reviews/         # Review management views
│   ├── layout/          # App layout components
│   ├── themes/          # Custom themes
│   └── ...
├── public/              # Public assets
├── .env.local           # Environment variables (not in git)
├── setup.ts             # Database seeding script
├── package.json         # Project dependencies
└── README.md            # Project documentation
```

## Available Scripts

- `npm run start` - Start development server at `http://localhost:8000`
- `npm run serve` - Preview production build
- `npm run build` - Build for production
- `npm run test` - Run tests
- `npm run lint` - Run ESLint
- `npm run db-seed` - Seed the Appwrite database

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Acknowledgments

- [React](https://reactjs.org/)
- [Vite](https://vitejs.dev/)
- [React-admin](https://marmelab.com/react-admin/)
- [Appwrite](https://appwrite.io/)
- [Material-UI](https://mui.com/)
