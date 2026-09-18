-- AVISO AL EQUIPO CUANDO SE ACTUALIZA UN DOCUMENTO (2026-09-18)
-- Correr COMPLETO en Supabase → SQL Editor. Se puede correr más de una vez.
-- Va con la función `aviso-documento` (Verify JWT apagado).
--
-- Cada archivo que entra al bucket `documentos` llama a la función con su
-- nombre. La función decide si avisa: solo por los documentos que la app
-- muestra, y una vez por hora por documento.

create or replace function public.avisar_documento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Si el aviso falla, la subida del archivo tiene que salir igual.
  if new.bucket_id = 'documentos' then
    begin
    perform net.http_post(
      url := 'https://ikybxeblnbbeqkpjggwe.supabase.co/functions/v1/aviso-documento',
      body := jsonb_build_object('nombre', new.name),
      timeout_milliseconds := 5000
    );
    exception when others then
      raise warning 'aviso-documento: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists avisar_documento on storage.objects;
create trigger avisar_documento
  after insert on storage.objects
  for each row execute function public.avisar_documento();

-- Comprobar:
--   select tgname from pg_trigger where tgname = 'avisar_documento';
