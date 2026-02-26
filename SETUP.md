# Setup — ejecutar en Supabase SQL Editor

```sql
create table fab_storage (
  key text primary key,
  value text,
  updated_at timestamp default now()
);

alter table fab_storage enable row level security;

create policy "Public access" on fab_storage
  for all using (true) with check (true);
```
