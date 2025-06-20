# Job Application Form with Formspree

A modern, responsive job application form built with React, Vite, and Tailwind CSS, integrated with Formspree for form submissions.

## Features

- 📝 Clean and professional job application form
- ⚡ Built with Vite for fast development
- 🔒 Secure form submissions via Formspree
- ✨ Real-time form validation

## Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v14 or higher)
- npm or yarn
- A Formspree account and form ID

## Quick Start

1. Clone the repository:
```bash
git clone https://github.com/yourusername/formspree-job-application-form.git
cd formspree-job-application-form
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Configure environment variables:
   - Copy the example environment file:
   ```bash
   cp env.example .env
   ```
   - Update the `.env` file with your Formspree form ID:
   ```env
   VITE_FORMSPREE_FORM_ID=your_form_id_here
   ```

4. Start the development server:
```bash
npm run dev
# or
yarn dev
```

5. Open your browser and visit `http://localhost:5173`

## Environment Variables

The following environment variables are required:

| Variable | Description | Example |
|----------|-------------|---------|
| VITE_FORMSPREE_FORM_ID | Your Formspree form ID | xrgkpqld |

## Project Structure

```
formspree-job-application-form/
├── src/
│   ├── App.jsx          # Main application component
│   ├── App.css          # Application styles
│   ├── main.jsx         # Entry point
│   └── assets/          # Static assets
├── public/              # Public assets
├── .env                 # Environment variables (not in git)
├── env.example          # Example environment variables
├── package.json         # Project dependencies
└── README.md           # Project documentation
```

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [React](https://reactjs.org/)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Formspree](https://formspree.io/)
