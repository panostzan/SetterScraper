globalThis.SETTERSCRAPER_CONFIG = Object.freeze({
  crmOrigin: 'https://your-crm.example.com',
  documentApiBase: 'https://your-document-api.example.com/v1/projects/your-project-id/databases/(default)/documents',
  auth: {
    databaseName: 'your-auth-database',
    storeName: 'your-auth-store',
  },
  schema: {
    collections: {
      clients: 'your-client-collection',
      projects: 'your-project-subcollection',
      users: 'your-user-collection',
    },
    fields: {
      createdByUserId: 'created-by-user-field',
      createdAt: 'created-at-field',
      firstName: 'first-name-field',
      lastName: 'last-name-field',
      phone: 'phone-field',
      email: 'email-field',
      address: 'address-field',
      street: 'street-field',
      city: 'city-field',
      province: 'province-field',
      postalCode: 'postal-code-field',
      consultation: 'consultation-field',
      pmUserId: 'project-manager-field',
      scheduledStart: 'scheduled-start-field',
      preferences: 'preferences-field',
      date: 'date-field',
      startTime: 'start-time-field',
      userName: 'user-name-field',
    },
  },
});

