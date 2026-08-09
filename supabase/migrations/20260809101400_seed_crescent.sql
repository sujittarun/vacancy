-- The first host. Inventory is loaded by the app on first sign-in, so this
-- creates only the tenant itself.
insert into public.hosts (slug, name)
values ('crescent-stays', 'Crescent Stays')
on conflict (slug) do nothing;
