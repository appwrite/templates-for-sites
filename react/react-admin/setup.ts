import generateData from "data-generator-retail";
import * as appwrite from "node-appwrite";
import {
  ID,
  Permission,
  Role,
  Query,
  RelationshipType,
  RelationMutate,
} from "node-appwrite";
import dotenv from "dotenv";
import path from "path";

const MAX_ERRORS = 5;

const forceSeed = process.argv.includes("--force");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

if (!process.env.VITE_APPWRITE_ENDPOINT) {
  throw new Error(
    "VITE_APPWRITE_ENDPOINT environment variable is not set."
  );
}
if (!process.env.VITE_APPWRITE_PROJECT_ID) {
  throw new Error("VITE_APPWRITE_PROJECT_ID environment variable is not set.");
}
if (!process.env.APPWRITE_API_KEY) {
  throw new Error(
    "APPWRITE_API_KEY environment variable is not set."
  );
}

const client = new appwrite.Client()
  .setEndpoint(process.env.VITE_APPWRITE_ENDPOINT)
  .setProject(process.env.VITE_APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const users = new appwrite.Users(client);

let user;
try {
  user = await users.get("johndoe");
} catch {}

if (user) {
  if (forceSeed) {
    console.log(
      'User "john.doe@marmelab.com" already exists. Deleting user...'
    );
    await users.delete("johndoe");
  } else {
    console.log(
      'User "john.doe@marmelab.com" already exists. Use --force to recreate it.'
    );
    console.log("Exiting.");
    process.exit(0);
  }
}

console.log('Creating user "john.doe@marmelab.com"...');
await users.create(
  "johndoe",
  "john.doe@marmelab.com",
  undefined,
  "changeme",
  "John Doe"
);

const tablesDB = new appwrite.TablesDB(client);

const result = await tablesDB.list([Query.equal("name", ["admin"])]);

if (result.total > 0) {
  if (forceSeed) {
    console.log('Database "admin" already exists. Deleting database...');
    await tablesDB.delete("admin");
  } else {
    console.log('Database "admin" already exists. Use --force to recreate it.');
    console.log("Exiting.");
    process.exit(0);
  }
}

console.log('Creating database "admin"...');
await tablesDB.create("admin", "admin");

const tables = [
  "baskets",
  "orders",
  "customers",
  "categories",
  "products",
  "invoices",
  "reviews",
] as const;
type TableName = (typeof tables)[number];

type Column = {
  key: string;
  type: "string" | "integer" | "float" | "boolean" | "date";
  size?: number;
  required?: boolean;
  array?: boolean;
};

const tableSchemas: Record<TableName, Column[]> = {
  baskets: [
    { key: "product_id", type: "integer" },
    { key: "quantity", type: "integer" },
  ],
  customers: [
    { key: "id", type: "integer", required: true },
    { key: "first_name", type: "string", size: 100 },
    { key: "last_name", type: "string", size: 100 },
    { key: "email", type: "string", size: 100 },
    { key: "address", type: "string", size: 100 },
    { key: "zipcode", type: "string", size: 100 },
    { key: "city", type: "string", size: 100 },
    { key: "stateAbbr", type: "string", size: 100 },
    { key: "avatar", type: "string", size: 100 },
    { key: "birthday", type: "string", size: 100, required: false },
    { key: "first_seen", type: "date" },
    { key: "last_seen", type: "date" },
    { key: "has_ordered", type: "boolean" },
    { key: "latest_purchase", type: "date" },
    { key: "has_newsletter", type: "boolean" },
    {
      key: "groups",
      type: "string",
      size: 100,
      array: true,
    },
    { key: "nb_orders", type: "integer" },
    { key: "total_spent", type: "float" },
  ],
  categories: [
    { key: "id", type: "integer", required: true },
    { key: "name", type: "string", size: 100, required: true },
  ],
  products: [
    { key: "id", type: "integer", required: true },
    { key: "category_id", type: "integer" },
    { key: "reference", type: "string", size: 100, required: true },
    { key: "width", type: "float" },
    { key: "height", type: "float" },
    { key: "price", type: "float" },
    { key: "thumbnail", type: "string", size: 100 },
    { key: "image", type: "string", size: 100 },
    { key: "description", type: "string", size: 5000 },
    { key: "stock", type: "integer" },
    { key: "sales", type: "float" },
  ],
  orders: [
    { key: "id", type: "integer", required: true },
    { key: "reference", type: "string", size: 100, required: true },
    { key: "date", type: "date" },
    { key: "customer_id", type: "integer" },
    { key: "total_ex_taxes", type: "float" },
    { key: "delivery_fees", type: "float" },
    { key: "tax_rate", type: "float" },
    { key: "taxes", type: "float" },
    { key: "total", type: "float" },
    { key: "status", type: "string", size: 100 },
    { key: "returned", type: "boolean" },
  ],
  invoices: [
    { key: "id", type: "integer", required: true },
    { key: "date", type: "date" },
    { key: "order_id", type: "integer" },
    { key: "customer_id", type: "integer" },
    { key: "total_ex_taxes", type: "float" },
    { key: "delivery_fees", type: "float" },
    { key: "tax_rate", type: "float" },
    { key: "taxes", type: "float" },
    { key: "total", type: "float" },
  ],
  reviews: [
    { key: "id", type: "integer", required: true },
    { key: "date", type: "date" },
    { key: "status", type: "string", size: 100 },
    { key: "order_id", type: "integer" },
    { key: "product_id", type: "integer" },
    { key: "customer_id", type: "integer" },
    { key: "rating", type: "integer" },
    { key: "comment", type: "string", size: 2000 },
  ],
};

for (const tableName of tables) {
  console.log(`Creating table "${tableName}"...`);
  await tablesDB.createTable("admin", tableName, tableName, [
    Permission.read(Role.users()),
    Permission.write(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ]);
}

for (const [tableName, columns] of Object.entries(tableSchemas)) {
  console.log(`Creating columns for table "${tableName}"...`);
  for (const column of columns) {
    switch (column.type) {
      case "string":
        await tablesDB.createStringColumn(
          "admin",
          tableName,
          column.key,
          column.size || 255,
          column.required || false,
          undefined,
          column.array || false
        );
        break;
      case "integer":
        await tablesDB.createIntegerColumn(
          "admin",
          tableName,
          column.key,
          column.required || false,
          undefined,
          undefined,
          undefined,
          column.array || false
        );
        break;
      case "float":
        await tablesDB.createFloatColumn(
          "admin",
          tableName,
          column.key,
          column.required || false,
          undefined,
          undefined,
          undefined,
          column.array || false
        );
        break;
      case "boolean":
        await tablesDB.createBooleanColumn(
          "admin",
          tableName,
          column.key,
          column.required || false,
          undefined,
          column.array || false
        );
        break;
      case "date":
        await tablesDB.createDatetimeColumn(
          "admin",
          tableName,
          column.key,
          column.required || false,
          undefined,
          column.array || false
        );
        break;
      default:
        throw new Error(`Unknown column type: ${column.type}`);
    }
  }
}
// Special case for basket - create relationship between orders and baskets
console.log('Creating relationship between orders and baskets...');
await tablesDB.createRelationshipColumn(
  "admin", // databaseId
  "orders", // tableId
  "baskets", // relatedTableId
  RelationshipType.OneToMany, // type
  false, // twoWay (optional)
  "basket", // key (optional)
  undefined, // twoWayKey (optional)
  RelationMutate.Cascade // onDelete (optional)
);

console.log("Generating data...");
const data = generateData();

// FIXME - Give 10 seconds for the schema to be updated
// Don't know why this is necessary, but yeah...
await new Promise((resolve) => setTimeout(resolve, 10000));

let errors = 0;
for (const tableName of tables) {
  if (tableName === "baskets") {
    continue;
  }
  console.log(`Inserting data into table "${tableName}"...`);
  for (const item of data[tableName]) {
    try {
      await tablesDB.createRow(
        "admin",
        tableName,
        // FIXME: createDocument considers 0 to be an invalid ID
        item.id ? item.id.toString() : ID.unique(),
        item,
        [
          Permission.read(Role.users()),
          Permission.write(Role.users()),
          Permission.update(Role.users()),
          Permission.delete(Role.users()),
        ]
      );
    } catch (error) {
      console.error(
        `Error inserting item into table "${tableName}":`,
        { error, item }
      );
      errors++;
      if (errors >= MAX_ERRORS) {
        console.error(`Reached maximum error limit of ${MAX_ERRORS}. Exiting.`);
        process.exit(1);
      }
    }
  }
}

console.log("TablesDB setup completed successfully.");
