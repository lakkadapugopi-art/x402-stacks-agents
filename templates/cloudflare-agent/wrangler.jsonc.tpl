{
  "name": "__PROJECT_NAME__",
  "main": "src/index.js",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    "STACKS_NETWORK": "__NETWORK__",
    "STACKS_API_URL": "__API_URL__",
    "PAY_TO": "__RECIPIENT__",
    "X402_TOKEN": "__TOKEN__",
    "X402_AMOUNT": "__AMOUNT__"
  },
  "durable_objects": {
    "bindings": [
      { "class_name": "PaidAgent", "name": "PaidAgent" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["PaidAgent"] }
  ]
}
