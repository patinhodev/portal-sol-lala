from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path
import base64
import sqlite3, json, os, re
import hashlib, hmac, secrets, math

ROOT=Path(__file__).resolve().parent
DATA_DIR=Path(os.environ.get('PORTAL_DATA_DIR',str(ROOT)))
DATA_DIR.mkdir(parents=True,exist_ok=True)
DB=DATA_DIR/'weekend.db'
INVOICE_DIR=ROOT/'static'/'notas-fiscais'
ADMIN_PASSWORD_HASH=os.environ.get('PORTAL_ADMIN_PASSWORD_HASH','')
MAX_BODY_BYTES=8*1024*1024
NAME_PATTERN=re.compile(r'^[\wÀ-ÿ .-]{1,80}$',re.UNICODE)

def conn():
    c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; return c

def init_db():
    c=conn(); c.executescript('''
    CREATE TABLE IF NOT EXISTS participants(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL,access_token TEXT,blocked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY AUTOINCREMENT,description TEXT NOT NULL,person TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS purchases(id INTEGER PRIMARY KEY AUTOINCREMENT,description TEXT NOT NULL,value REAL NOT NULL,person TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY AUTOINCREMENT,description TEXT NOT NULL,value REAL NOT NULL,added_by TEXT NOT NULL,photo TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS shopping_notes(id INTEGER PRIMARY KEY AUTOINCREMENT,note TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checklist(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,description TEXT NOT NULL,person TEXT,done INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS rules(id INTEGER PRIMARY KEY AUTOINCREMENT,description TEXT NOT NULL,source TEXT);
    CREATE TABLE IF NOT EXISTS ideas(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,description TEXT NOT NULL,person TEXT NOT NULL);
    ''')
    checklist_columns={row[1] for row in c.execute('PRAGMA table_info(checklist)')}
    if 'user_added' not in checklist_columns:
        c.execute('ALTER TABLE checklist ADD COLUMN user_added INTEGER NOT NULL DEFAULT 0')
    invoice_columns={row[1] for row in c.execute('PRAGMA table_info(invoices)')}
    if 'photo' not in invoice_columns:
        c.execute("ALTER TABLE invoices ADD COLUMN photo TEXT NOT NULL DEFAULT ''")
    participant_columns={row[1] for row in c.execute('PRAGMA table_info(participants)')}
    if 'access_token' not in participant_columns:
        c.execute("ALTER TABLE participants ADD COLUMN access_token TEXT")
    if 'blocked' not in participant_columns:
        c.execute("ALTER TABLE participants ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0")
    shopping_note_columns={row[1] for row in c.execute('PRAGMA table_info(shopping_notes)')}
    if 'added_by' not in shopping_note_columns:
        c.execute("ALTER TABLE shopping_notes ADD COLUMN added_by TEXT NOT NULL DEFAULT ''")
    default_checklist = (
        'Verificar limpeza geral da casa',
        'Conferir utensílios e eletrodomésticos',
        'Verificar quartos, camas e banheiros',
        'Conferir piscina e área externa',
        'Registrar qualquer dano ou problema encontrado',
        'Testar torneiras e descargas',
        'Conferir roupas de cama e toalhas',
        'Verificar a iluminação dos ambientes',
        'Conferir churrasqueira e utensílios',
        'Registrar a condição da piscina',
        'Guardar e lavar toda a louça',
        'Retirar o lixo',
        'Conferir quartos e banheiros',
        'Deixar a piscina e áreas externas organizadas',
        'Apagar luzes e fechar portões',
        'Conferir se ninguém esqueceu objetos pessoais',
        'Conferir torneiras e chuveiros',
        'Testar a iluminação dos cômodos',
        'Organizar a área da churrasqueira',
        'Conferir geladeira e freezer',
        'Recolher objetos pessoais',
        'Verificar portas e janelas fechadas',
        'Conferir churrasqueira e área gourmet',
        'Desligar aparelhos eletrônicos',
        'Guardar as chaves no local combinado',
        'Fechar todas as janelas',
    )
    c.execute("DELETE FROM checklist WHERE TRIM(description) = ''")
    placeholders = ','.join('?' for _ in default_checklist)
    c.execute(
        f"UPDATE checklist SET user_added=CASE WHEN description IN ({placeholders}) THEN 0 ELSE 1 END",
        default_checklist,
    )
    participants = ['Ana', 'Chintia', 'Fabiano', 'Lucas', 'Renata', 'Rodrigo', 'Tuane', 'Vincius']
    if c.execute('SELECT COUNT(*) FROM participants').fetchone()[0] == 0:
        c.executemany('INSERT INTO participants(name) VALUES (?)', [(name,) for name in participants])
    else:
        c.execute('INSERT OR IGNORE INTO participants(name) VALUES (?)', ('Fabiano',))
    for participant_id, in c.execute('SELECT id FROM participants WHERE access_token IS NULL OR access_token=""').fetchall():
        c.execute('UPDATE participants SET access_token=? WHERE id=?',(secrets.token_urlsafe(24),participant_id))
    if c.execute('SELECT COUNT(*) FROM rules').fetchone()[0]==0:
        c.executemany('INSERT INTO rules(description,source) VALUES (?,?)',[(x,'Sobre o Espaço / orientação cadastrada') for x in ['Proibido som alto após 22h','Não fumar dentro da casa','Não levar animais sem autorização','Manter a área da piscina limpa','Desligar luzes e fechar portões ao sair']])
    if c.execute("SELECT COUNT(*) FROM checklist WHERE kind='checkin'").fetchone()[0]==0:
        c.executemany('INSERT INTO checklist(kind,description) VALUES (?,?)',[('checkin',x) for x in ['Verificar limpeza geral da casa','Conferir utensílios e eletrodomésticos','Verificar quartos, camas e banheiros','Conferir piscina e área externa','Registrar qualquer dano ou problema encontrado']])
    if c.execute("SELECT COUNT(*) FROM checklist WHERE kind='checkout'").fetchone()[0]==0:
        c.executemany('INSERT INTO checklist(kind,description) VALUES (?,?)',[('checkout',x) for x in ['Guardar e lavar toda a louça','Retirar o lixo','Conferir quartos e banheiros','Deixar a piscina e áreas externas organizadas','Apagar luzes e fechar portões','Conferir se ninguém esqueceu objetos pessoais']])
    extra_checkin = ['Conferir torneiras e chuveiros', 'Testar a iluminação dos cômodos', 'Organizar a área da churrasqueira', 'Testar torneiras e descargas', 'Conferir roupas de cama e toalhas', 'Verificar a iluminação dos ambientes', 'Conferir churrasqueira e utensílios', 'Registrar a condição da piscina']
    extra_checkout = ['Conferir geladeira e freezer', 'Recolher objetos pessoais', 'Verificar portas e janelas fechadas', 'Conferir churrasqueira e área gourmet', 'Desligar aparelhos eletrônicos', 'Guardar as chaves no local combinado', 'Fechar todas as janelas']
    for description in extra_checkin:
        c.execute("INSERT INTO checklist(kind, description) SELECT 'checkin', ? WHERE NOT EXISTS (SELECT 1 FROM checklist WHERE kind='checkin' AND description=?)", (description, description))
    for description in extra_checkout:
        c.execute("INSERT INTO checklist(kind, description) SELECT 'checkout', ? WHERE NOT EXISTS (SELECT 1 FROM checklist WHERE kind='checkout' AND description=?)", (description, description))
    c.commit(); c.close()

def rows(c,q,args=()): return [dict(x) for x in c.execute(q,args).fetchall()]

def participant_from_token(c, token):
    if not token:
        return None
    return c.execute('SELECT id,name,blocked FROM participants WHERE access_token=?',(token,)).fetchone()

def state(token=''):
    c=conn(); current=participant_from_token(c,token)
    participants=rows(c,'SELECT id,name,blocked FROM participants WHERE blocked=0 ORDER BY name'); purchases=rows(c,'SELECT * FROM purchases ORDER BY id DESC'); invoices=rows(c,'SELECT * FROM invoices ORDER BY id DESC'); shopping_notes=rows(c,'SELECT * FROM shopping_notes ORDER BY id DESC')
    total=sum(float(x['value']) for x in purchases); names=[x['name'] for x in participants]; share=total/len(names) if names else 0
    paid={n:0 for n in names}
    for x in purchases: paid[x['person']]=paid.get(x['person'],0)+float(x['value'])
    registered_payers=sorted({x['person'] for x in purchases if x['person'].strip()})
    balances=[{'name':n,'paid':paid.get(n,0),'balance':paid.get(n,0)-share} for n in registered_payers]
    data={'participants':participants,'items':rows(c,'SELECT * FROM items ORDER BY id DESC'),'purchases':purchases,'invoices':invoices,'shopping_notes':shopping_notes,
          'checkin':rows(c,"SELECT * FROM checklist WHERE kind='checkin' ORDER BY id"),'checkout':rows(c,"SELECT * FROM checklist WHERE kind='checkout' ORDER BY id"),
          'rules':rows(c,'SELECT * FROM rules ORDER BY id'),'activities':rows(c,"SELECT * FROM ideas WHERE kind='atividade' ORDER BY id DESC"),
          'foods':rows(c,"SELECT * FROM ideas WHERE kind='comida' ORDER BY id DESC"),'drinks':rows(c,"SELECT * FROM ideas WHERE kind='bebida' ORDER BY id DESC"),
          'total':total,'share':share,'balances':balances,
          'current_participant':dict(current) if current and not current['blocked'] else None}
    c.close(); return data

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT),**kwargs)
    def send_json(self,obj,status=200):
        b=json.dumps(obj,ensure_ascii=False).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(b))); self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Referrer-Policy','no-referrer'); self.end_headers(); self.wfile.write(b)
    def body(self):
        n=int(self.headers.get('Content-Length','0'))
        if n>MAX_BODY_BYTES: raise ValueError('requisição muito grande')
        raw=self.rfile.read(n) if n else b'{}'; return json.loads(raw or b'{}')
    def participant(self,c,token):
        person=participant_from_token(c,token)
        if not person or person['blocked']: raise PermissionError('link de participante inválido ou bloqueado')
        return person
    def admin_password(self,d):
        supplied=str(d.get('password',''))
        if not ADMIN_PASSWORD_HASH:
            return False
        if ADMIN_PASSWORD_HASH.startswith('pbkdf2_sha256$'):
            try:
                _, rounds, salt, expected = ADMIN_PASSWORD_HASH.split('$', 3)
                actual=hashlib.pbkdf2_hmac('sha256', supplied.encode(), bytes.fromhex(salt), int(rounds)).hex()
                return hmac.compare_digest(actual, expected)
            except (ValueError, TypeError):
                return False
        actual=hashlib.sha256(('portal-sol-lala-admin:'+supplied).encode()).hexdigest()
        return hmac.compare_digest(actual, ADMIN_PASSWORD_HASH)
    def do_GET(self):
        parsed=urlparse(self.path); query=parse_qs(parsed.query); token=query.get('p',[''])[0]
        if parsed.path=='/api/state': return self.send_json(state(token))
        return super().do_GET()
    def do_POST(self):
        parsed=urlparse(self.path); p=parsed.path; query=parse_qs(parsed.query); token=query.get('p',[''])[0]
        try: d=self.body()
        except (ValueError,json.JSONDecodeError): return self.send_json({'error':'requisição inválida'},400)
        c=conn()
        try:
            if p=='/api/admin/links':
                if not self.admin_password(d): return self.send_json({'error':'não autorizado'},401)
                links=[{'id':r['id'],'name':r['name'],'link':f'?p={r["access_token"]}','blocked':bool(r['blocked'])} for r in c.execute('SELECT id,name,access_token,blocked FROM participants ORDER BY name')]
                return self.send_json({'links':links})
            if p in ('/api/admin/block','/api/admin/unblock'):
                if not self.admin_password(d): return self.send_json({'error':'não autorizado'},401)
                c.execute('UPDATE participants SET blocked=? WHERE id=?',(1 if p.endswith('/block') else 0,int(d['participant_id'])))
            else:
                person=self.participant(c,token)
                if p=='/api/participants':
                    name=d.get('name','').strip()
                    if not NAME_PATTERN.fullmatch(name): return self.send_json({'error':'nome inválido'},400)
                    c.execute('INSERT OR IGNORE INTO participants(name) VALUES (?)',(name,))
                elif p=='/api/items':
                    description=str(d.get('description','')).strip()
                    if not description or len(description)>300: return self.send_json({'error':'descrição obrigatória e limitada a 300 caracteres'},400)
                    c.execute('INSERT INTO items(description,person) VALUES (?,?)',(description,person['name']))
                elif p=='/api/purchases':
                    description=str(d.get('description','')).strip()
                    value=float(str(d.get('value',0)).replace(',','.'))
                    if not description or len(description)>300 or not math.isfinite(value) or value<0 or value>1000000: return self.send_json({'error':'compra ou valor inválido'},400)
                    c.execute('INSERT INTO purchases(description,value,person) VALUES (?,?,?)',(description,value,person['name']))
                elif p=='/api/invoices':
                    added_by=person['name']; photo=d.get('photo','')
                    if not photo.startswith('data:image/'): return self.send_json({'error':'envie uma foto válida'},400)
                    header, encoded=photo.split(',',1); extension=header.split(';',1)[0].split('/',1)[1]
                    if extension not in ('jpeg','jpg','png','webp'): return self.send_json({'error':'formato de foto não permitido'},400)
                    INVOICE_DIR.mkdir(parents=True,exist_ok=True); filename=f'nota-{secrets.token_hex(8)}.{extension}'
                    decoded=base64.b64decode(encoded,validate=True)
                    if len(decoded)>5*1024*1024: return self.send_json({'error':'a foto deve ter no máximo 5 MB'},400)
                    signatures={'jpeg':(b'\xff\xd8\xff',),'jpg':(b'\xff\xd8\xff',),'png':(b'\x89PNG\r\n\x1a\n',),'webp':(b'RIFF',)}
                    if not any(decoded.startswith(signature) for signature in signatures[extension]):
                        return self.send_json({'error':'conteúdo da foto inválido'},400)
                    (INVOICE_DIR/filename).write_bytes(decoded)
                    c.execute('INSERT INTO invoices(description,value,added_by,photo) VALUES (?,?,?,?)',('Nota fiscal',0,added_by,f'static/notas-fiscais/{filename}'))
                elif p=='/api/shopping-notes':
                    note=str(d.get('note','')).strip()
                    if not note or len(note)>300: return self.send_json({'error':'item obrigatório e limitado a 300 caracteres'},400)
                    c.execute('INSERT INTO shopping_notes(note,added_by) VALUES (?,?)',(note,person['name']))
                elif p=='/api/checklist':
                    description=str(d.get('description','')).strip()
                    if d.get('kind') not in ('checkin','checkout') or not description or len(description)>300: return self.send_json({'error':'descrição obrigatória e limitada a 300 caracteres'},400)
                    c.execute('INSERT INTO checklist(kind,description,person,user_added) VALUES (?,?,?,1)',(d['kind'],description,person['name']))
                elif p=='/api/toggle': c.execute('UPDATE checklist SET done=CASE done WHEN 0 THEN 1 ELSE 0 END WHERE id=?',(int(d['id']),))
                elif p=='/api/ideas':
                    description=str(d.get('description','')).strip()
                    if d.get('kind') not in ('atividade','comida','bebida') or not description or len(description)>300: return self.send_json({'error':'sugestão inválida'},400)
                    c.execute('INSERT INTO ideas(kind,description,person) VALUES (?,?,?)',(d['kind'],description,person['name']))
                elif p=='/api/rules':
                    description=str(d.get('description','')).strip()
                    if not description or len(description)>300: return self.send_json({'error':'regra inválida'},400)
                    c.execute('INSERT INTO rules(description,source) VALUES (?,?)',(description,'Adicionada pelo grupo'))
                else: return self.send_json({'error':'rota inválida'},404)
            c.commit(); self.send_json({'ok':True,'state':state()})
        except (ValueError,KeyError,TypeError,sqlite3.Error) as e: self.send_json({'error':'dados inválidos'},400)
        except PermissionError as e: self.send_json({'error':str(e)},403)
        finally: c.close()
    def do_DELETE(self):
        parsed=urlparse(self.path); query=parse_qs(parsed.query); token=query.get('p',[''])[0]; p=parsed.path.split('/')
        if len(p)==4 and p[1]=='api':
            table=p[2]; id=p[3]; allowed={'participants','items','purchases','invoices','shopping_notes','checklist','ideas','rules'}
            if table not in allowed: return self.send_json({'error':'não permitido'},400)
            c=conn()
            try: self.participant(c,token)
            except PermissionError: c.close(); return self.send_json({'error':'link de participante inválido ou bloqueado'},403)
            try: row_id=int(id)
            except ValueError: c.close(); return self.send_json({'error':'identificador inválido'},400)
            if table == 'invoices':
                invoice=c.execute('SELECT photo FROM invoices WHERE id=?',(row_id,)).fetchone()
                if invoice and invoice['photo']:
                    photo_path=ROOT/invoice['photo'].replace('static/','',1)
                    if photo_path.is_file(): photo_path.unlink()
            c.execute(f'DELETE FROM {table} WHERE id=?',(row_id,)); c.commit(); c.close(); return self.send_json({'ok':True,'state':state()})
        return self.send_json({'error':'rota inválida'},404)

if __name__=='__main__':
    init_db(); print('Portal do Sol rodando em http://127.0.0.1:8000'); ThreadingHTTPServer(('127.0.0.1',8000),Handler).serve_forever()
