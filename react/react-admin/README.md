# React-admin Demo With AppWrite

This is a demo of the [AppWrite](https://appwrite.io/) adapter for [react-admin](https://github.com/marmelab/react-admin).

To explore the source code, start with [src/App.tsx](https://github.com/marmelab/ra-appwrite/blob/main/packages/demo/src/App.tsx).

## Requirements

To run this demo, you must have configured an **Appwrite project**. You can either use an existing project or create a new one.

This project comes with a script that will create the necessary **database**, **collections** and **users** for you. This script will be run against the Appwrite project you choose in the `.env.local` file.

## How to run

Clone the `ra-appwrite` repository, then copy the `packages/demo/.env.local-example` file to `packages/demo/.env.local` and fill in the appwrite endpoint, project id and API key to use.

> To create an API key, go to your Appwrite console, navigate to your project, then "Overview". Scroll down to the "API Keys" section and create a new key with the `users` and `database` scopes.

Then run the following commands at the root of the repository:

```sh
# Install dependencies
make install

# Build the packages
make build

# Create the database, collections and users
make db-seed

# Start the demo app
make run
```
