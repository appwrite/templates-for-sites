import generateData from 'data-generator-retail';
import * as appwrite from 'node-appwrite';
import {
    ID,
    Permission,
    Role,
    Query,
    RelationshipType,
    RelationMutate,
} from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'path';

const MAX_ERRORS = 5;

const forceSeed = process.argv.includes('--force');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (!process.env.APPWRITE_SITE_API_ENDPOINT) {
    throw new Error(
        'APPWRITE_SITE_API_ENDPOINT environment variable is not set.'
    );
}
if (!process.env.APPWRITE_SITE_PROJECT_ID) {
    throw new Error(
        'APPWRITE_SITE_PROJECT_ID environment variable is not set.'
    );
}
if (!process.env.APPWRITE_SITE_STANDARD_KEY) {
    throw new Error(
        'APPWRITE_SITE_STANDARD_KEY environment variable is not set.'
    );
}

const client = new appwrite.Client()
    .setEndpoint(process.env.APPWRITE_SITE_API_ENDPOINT)
    .setProject(process.env.APPWRITE_SITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_SITE_STANDARD_KEY);

const users = new appwrite.Users(client);

let user;
try {
    user = await users.get('johndoe');
} catch {}

if (user) {
    if (forceSeed) {
        console.log(
            'User "john.doe@marmelab.com" already exists. Deleting user...'
        );
        await users.delete('johndoe');
    } else {
        console.log(
            'User "john.doe@marmelab.com" already exists. Use --force to recreate it.'
        );
        console.log('Exiting.');
        process.exit(0);
    }
}

console.log('Creating user "john.doe@marmelab.com"...');
await users.create(
    'johndoe',
    'john.doe@marmelab.com',
    undefined,
    'changeme',
    'John Doe'
);

const databases = new appwrite.Databases(client);

const result = await databases.list([Query.equal('name', ['admin'])]);

if (result.total > 0) {
    if (forceSeed) {
        console.log('Database "admin" already exists. Deleting database...');
        await databases.delete('admin');
    } else {
        console.log(
            'Database "admin" already exists. Use --force to recreate it.'
        );
        console.log('Exiting.');
        process.exit(0);
    }
}

console.log('Creating database "admin"...');
await databases.create('admin', 'admin');

const collections = [
    'baskets',
    'orders',
    'customers',
    'categories',
    'products',
    'invoices',
    'reviews',
] as const;
type CollectionName = (typeof collections)[number];

type Attribute = {
    key: string;
    type: 'string' | 'integer' | 'float' | 'boolean' | 'date';
    size?: number;
    required?: boolean;
    array?: boolean;
};

const collectionTypes: Record<CollectionName, Attribute[]> = {
    baskets: [
        { key: 'product_id', type: 'integer' },
        { key: 'quantity', type: 'integer' },
    ],
    customers: [
        { key: 'id', type: 'integer', required: true },
        { key: 'first_name', type: 'string', size: 100 },
        { key: 'last_name', type: 'string', size: 100 },
        { key: 'email', type: 'string', size: 100 },
        { key: 'address', type: 'string', size: 100 },
        { key: 'zipcode', type: 'string', size: 100 },
        { key: 'city', type: 'string', size: 100 },
        { key: 'stateAbbr', type: 'string', size: 100 },
        { key: 'avatar', type: 'string', size: 100 },
        { key: 'birthday', type: 'string', size: 100, required: false },
        { key: 'first_seen', type: 'date' },
        { key: 'last_seen', type: 'date' },
        { key: 'has_ordered', type: 'boolean' },
        { key: 'latest_purchase', type: 'date' },
        { key: 'has_newsletter', type: 'boolean' },
        {
            key: 'groups',
            type: 'string',
            size: 100,
            array: true,
        },
        { key: 'nb_orders', type: 'integer' },
        { key: 'total_spent', type: 'float' },
    ],
    categories: [
        { key: 'id', type: 'integer', required: true },
        { key: 'name', type: 'string', size: 100, required: true },
    ],
    products: [
        { key: 'id', type: 'integer', required: true },
        { key: 'category_id', type: 'integer' },
        { key: 'reference', type: 'string', size: 100, required: true },
        { key: 'width', type: 'float' },
        { key: 'height', type: 'float' },
        { key: 'price', type: 'float' },
        { key: 'thumbnail', type: 'string', size: 100 },
        { key: 'image', type: 'string', size: 100 },
        { key: 'description', type: 'string', size: 5000 },
        { key: 'stock', type: 'integer' },
        { key: 'sales', type: 'float' },
    ],
    orders: [
        { key: 'id', type: 'integer', required: true },
        { key: 'reference', type: 'string', size: 100, required: true },
        { key: 'date', type: 'date' },
        { key: 'customer_id', type: 'integer' },
        { key: 'total_ex_taxes', type: 'float' },
        { key: 'delivery_fees', type: 'float' },
        { key: 'tax_rate', type: 'float' },
        { key: 'taxes', type: 'float' },
        { key: 'total', type: 'float' },
        { key: 'status', type: 'string', size: 100 },
        { key: 'returned', type: 'boolean' },
    ],
    invoices: [
        { key: 'id', type: 'integer', required: true },
        { key: 'date', type: 'date' },
        { key: 'order_id', type: 'integer' },
        { key: 'customer_id', type: 'integer' },
        { key: 'total_ex_taxes', type: 'float' },
        { key: 'delivery_fees', type: 'float' },
        { key: 'tax_rate', type: 'float' },
        { key: 'taxes', type: 'float' },
        { key: 'total', type: 'float' },
    ],
    reviews: [
        { key: 'id', type: 'integer', required: true },
        { key: 'date', type: 'date' },
        { key: 'status', type: 'string', size: 100 },
        { key: 'order_id', type: 'integer' },
        { key: 'product_id', type: 'integer' },
        { key: 'customer_id', type: 'integer' },
        { key: 'rating', type: 'integer' },
        { key: 'comment', type: 'string', size: 2000 },
    ],
};

for (const collectionName of collections) {
    console.log(`Creating collection "${collectionName}"...`);
    await databases.createCollection('admin', collectionName, collectionName, [
        Permission.read(Role.users()),
        Permission.write(Role.users()),
        Permission.update(Role.users()),
        Permission.delete(Role.users()),
    ]);
}

for (const [collectionName, attributes] of Object.entries(collectionTypes)) {
    console.log(`Creating attributes for collection "${collectionName}"...`);
    for (const attribute of attributes) {
        switch (attribute.type) {
            case 'string':
                await databases.createStringAttribute(
                    'admin',
                    collectionName,
                    attribute.key,
                    attribute.size || 255,
                    attribute.required || false,
                    undefined,
                    attribute.array || false
                );
                break;
            case 'integer':
                await databases.createIntegerAttribute(
                    'admin',
                    collectionName,
                    attribute.key,
                    attribute.required || false,
                    undefined,
                    undefined,
                    undefined,
                    attribute.array || false
                );
                break;
            case 'float':
                await databases.createFloatAttribute(
                    'admin',
                    collectionName,
                    attribute.key,
                    attribute.required || false,
                    undefined,
                    undefined,
                    undefined,
                    attribute.array || false
                );
                break;
            case 'boolean':
                await databases.createBooleanAttribute(
                    'admin',
                    collectionName,
                    attribute.key,
                    attribute.required || false,
                    undefined,
                    attribute.array || false
                );
                break;
            case 'date':
                await databases.createDatetimeAttribute(
                    'admin',
                    collectionName,
                    attribute.key,
                    attribute.required || false,
                    undefined,
                    attribute.array || false
                );
                break;
            default:
                throw new Error(`Unknown attribute type: ${attribute.type}`);
        }
    }
}
// Special case for basket
await databases.createRelationshipAttribute(
    'admin', // databaseId
    'orders', // collectionId
    'baskets', // relatedCollectionId
    RelationshipType.OneToMany, // type
    false, // twoWay (optional)
    'basket', // key (optional)
    undefined, // twoWayKey (optional)
    RelationMutate.Cascade // onDelete (optional)
);

console.log('Generating data...');
// @ts-expect-error - Dunno why this is necessary, but the import is not recognized
const data = generateData.default();

// FIXME - Give 10 seconds for the schema to be updated
// Don't know why this is necessary, but yeah...
await new Promise(resolve => setTimeout(resolve, 10000));

let errors = 0;
for (const collectionName of collections) {
    if (collectionName === 'baskets') {
        continue;
    }
    console.log(`Inserting data into collection "${collectionName}"...`);
    for (const item of data[collectionName]) {
        try {
            await databases.createDocument(
                'admin',
                collectionName,
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
                `Error inserting item into collection "${collectionName}":`,
                { error, item }
            );
            errors++;
            if (errors >= MAX_ERRORS) {
                console.error(
                    `Reached maximum error limit of ${MAX_ERRORS}. Exiting.`
                );
                process.exit(1);
            }
        }
    }
}

console.log('Database setup completed successfully.');
