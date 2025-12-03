# React-admin Demo With Appwrite

This is a demo of the [Appwrite](https://appwrite.io/) adapter for [react-admin](https://github.com/marmelab/react-admin), a frontend framework for building B2B applications on top of REST/GraphQL APIs.

## Features

- ⚡ A complete admin dashboard built with [React-admin](https://marmelab.com/react-admin/)
- 💿 Backed by an [Appwrite](https://appwrite.io/) backend using TablesDB
- ⚙️ Automatic database, table, and user seeding
- 🎨 Rich UI components from Material-UI

## Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v18 or higher recommended)
- npm or yarn
- An Appwrite project

## Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/appwrite/templates-for-sites.git
   cd react/react-admin
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Configure environment variables:
   - Create a `.env` file in the `react/react-admin` directory.
   - Add the following environment variables to your `.env` file:
   ```env
   VITE_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
   VITE_APPWRITE_PROJECT_ID=your_project_id_here
   VITE_APPWRITE_DATABASE_ID=admin
   VITE_APPWRITE_COLLECTION_REVIEWS=reviews
   VITE_APPWRITE_COLLECTION_INVOICES=invoices
   VITE_APPWRITE_COLLECTION_ORDERS=orders
   VITE_APPWRITE_COLLECTION_PRODUCTS=products
   VITE_APPWRITE_COLLECTION_CATEGORIES=categories
   VITE_APPWRITE_COLLECTION_CUSTOMERS=customers
   APPWRITE_API_KEY=your_api_key_here
   ```
   > To create an API key, go to your Appwrite console, navigate to your project, then "API Keys". Create a new key with `users` and `databases` scopes.

4. Seed the database:
   This command will create the necessary database, tables, and a demo user (`john.doe@marmelab.com`, password: `changeme`).
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

| Variable                              | Description                                | Example                        |
| ------------------------------------- | ------------------------------------------ | ------------------------------ |
| VITE_APPWRITE_ENDPOINT                | Your Appwrite project endpoint.            | `https://cloud.appwrite.io/v1` |
| VITE_APPWRITE_PROJECT_ID              | Your Appwrite project ID.                  | `60b8...`                      |
| VITE_APPWRITE_DATABASE_ID             | Database ID (default: admin).              | `admin`                        |
| VITE_APPWRITE_COLLECTION_REVIEWS      | Collection ID for reviews table.           | `reviews`                      |
| VITE_APPWRITE_COLLECTION_INVOICES     | Collection ID for invoices table.          | `invoices`                     |
| VITE_APPWRITE_COLLECTION_ORDERS       | Collection ID for orders table.            | `orders`                       |
| VITE_APPWRITE_COLLECTION_PRODUCTS     | Collection ID for products table.          | `products`                     |
| VITE_APPWRITE_COLLECTION_CATEGORIES   | Collection ID for categories table.        | `categories`                   |
| VITE_APPWRITE_COLLECTION_CUSTOMERS    | Collection ID for customers table.         | `customers`                    |
| APPWRITE_API_KEY                      | Your Appwrite API key (for seeding only).  | `a0b1...`                      |


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
├── .env                 # Environment variables (not in git)
├── setup.ts             # Database seeding script
├── package.json         # Project dependencies
└── README.md            # Project documentation
```

## Available Scripts

- `npm run start` - Start development server at `http://localhost:8000`
- `npm run serve` - Preview production build
- `npm run build` - Build for production
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
