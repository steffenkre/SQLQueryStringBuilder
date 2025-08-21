const el = (id) => document.getElementById(id);
const setList = el('setList');
const whereList = el('whereList');
const setRowTpl = el('setRowTpl');
const whereRowTpl = el('whereRowTpl');

const addRow = (tpl, parent) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('[data-action="remove"]').addEventListener('click', () => node.remove());
    parent.appendChild(node);
};

el('addSet').addEventListener('click', () => addRow(setRowTpl, setList));
el('addWhere').addEventListener('click', () => addRow(whereRowTpl, whereList));

// Start with one row each
addRow(setRowTpl, setList);
addRow(whereRowTpl, whereList);

const getRows = (parent) => {
    return [...parent.querySelectorAll('.item')].map(item => ({
    col: item.querySelector('.colName').value.trim(),
    op: item.querySelector('.operator').value,
    key: item.querySelector('.paramKey').value.trim(),
    })).filter(r => r.col);
};

const buildPlaceholder = (style, key, index) => {
    switch(style){
    case '?': return '?';
    case '%s': return '%s';
    case '%d': return '%d';
    case ':named': return ':' + (key || ('p'+(index+1)));
    default: return '?';
    }
};

const buildParams = (style, rows) => {
    if(style === ':named'){
    const obj = {};
    rows.forEach((r,i) => {
        const k = r.key || ('p'+(i+1));
        obj[k] = `/* ${r.col} */`;
    });
    return obj;
    }
    // positional
    return rows.map(r => `/* ${r.col} */`);
};

const q = {
    create({table, sets, placeholder}){
        const cols = sets.map(s=>`\`${s.col}\``).join(', ');
        const vals = sets.map((s,i)=>buildPlaceholder(placeholder, s.key, i)).join(', ');
        return `INSERT INTO \`${table}\` (${cols})\nVALUES (${vals});`;
    },
        read({table, selects, wheres, orderBy, limit, placeholder}){
        const sel = selects.length ? selects.join(', ') : '*';
        const where = wheres.length ? ('\nWHERE ' + wheres.map((w,i)=>`\`${w.col}\` ${w.op} ${buildPlaceholder(placeholder, w.key, i)}`).join(' AND ')) : '';
        const order = orderBy ? ('\nORDER BY ' + orderBy) : '';
        const lim = limit ? ('\nLIMIT ' + Number(limit)) : '';
        return `SELECT ${sel} FROM \`${table}\`${where}${order}${lim};`;
    },
        update({table, sets, wheres, placeholder}){
        const set = sets.map((s,i)=>`\`${s.col}\` = ${buildPlaceholder(placeholder, s.key, i)}`).join(', ');
        const where = wheres.length ? ('\nWHERE ' + wheres.map((w,i)=>`\`${w.col}\` ${w.op} ${buildPlaceholder(placeholder, w.key, sets.length + i)}`).join(' AND ')) : '';
        return `UPDATE \`${table}\`\nSET ${set}${where};`;
    },
        delete({table, wheres, placeholder}){
        const where = wheres.length ? ('\nWHERE ' + wheres.map((w,i)=>`\`${w.col}\` ${w.op} ${buildPlaceholder(placeholder, w.key, i)}`).join(' AND ')) : '';
        return `DELETE FROM \`${table}\`${where};`;
    },
};

const buildSnippet = ({language, dbType, placeholder, sql, setRows, whereRows}) => {
    const allRows = [...setRows, ...whereRows];
    const paramObj = buildParams(placeholder, allRows);
    const meta = `${language} • ${dbType} • Platzhalter: ${placeholder}`;

    const jsStringify = (v) => JSON.stringify(v, null, 2);

    let code = '';
    if(language === 'JavaScript'){
    if(dbType === 'MySQL'){
        code = `// mit mysql2 (Node.js)\nimport mysql from 'mysql2/promise';\nconst pool = mysql.createPool({ host:'localhost', user:'root', database:'test' });\n\nconst sql = ${JSON.stringify(sql)};\nconst params = ${jsStringify(paramObj)};\nconst [rows] = await pool.execute(sql, params);`;
    } else { // SQLite mit Node.js nativem sqlite
        code = `// mit sqlite3 (Node.js native)\nimport sqlite3 from 'sqlite3';\nimport { open } from 'sqlite';\n\nconst db = await open({ filename: 'app.db', driver: sqlite3.Database });\n\nconst sql = ${JSON.stringify(sql)};\nconst params = ${jsStringify(paramObj)};\n\n// für SELECT
            if(sql.trim().toUpperCase().startsWith('SELECT')) {
            const rows = await db.all(sql, params);
            } else {
            await db.run(sql, params);
            }`;
    }
    }
    else if(language === 'PHP'){
    if(dbType === 'MySQL'){
        code = `<?php\n$pdo = new PDO('mysql:host=localhost;dbname=test;charset=utf8mb4', 'user', 'pass', [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);\n$sql = ${JSON.stringify(sql)};\n$params = ${placeholder === ':named' ? '/* assoc array */' : '/* index array */'};\n$params = ${placeholder === ':named' ? '[]' : '[]'}; // TODO: Werte einsetzen\n$stmt = $pdo->prepare($sql);\n$stmt->execute($params);\n${['read'].includes(el('method').value) ? '$data = $stmt->fetchAll(PDO::FETCH_ASSOC);' : ''}\n?>`;
    } else { // SQLite
        code = `<?php\n$pdo = new PDO('sqlite:app.db', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);\n$sql = ${JSON.stringify(sql)};\n$params = ${placeholder === ':named' ? '[]' : '[]'}; // TODO\n$stmt = $pdo->prepare($sql);\n$stmt->execute($params);\n${['read'].includes(el('method').value) ? '$data = $stmt->fetchAll(PDO::FETCH_ASSOC);' : ''}\n?>`;
    }
    }
    else if(language === 'Python'){
    if(dbType === 'MySQL'){
        const pyPlaceholder = (placeholder === '?') ? '%s' : (placeholder === ':named' ? '%(name)s' : placeholder);
        const sqlPy = sql.replaceAll(':', '%(').replaceAll(')', ')s'); // naive for named
        const finalSQL = (placeholder === ':named') ? sqlPy : sql.replaceAll(placeholder, pyPlaceholder);
        code = `# mit mysql-connector-python\nimport mysql.connector as mc\nconn = mc.connect(host='localhost', user='root', password='pass', database='test')\ncur = conn.cursor(dictionary=True)\nsql = ${JSON.stringify(finalSQL)}\nparams = ${Array.isArray(paramObj) ? '[' + paramObj.map(()=>"...").join(', ') + ']' : '{' + Object.keys(paramObj).map(k=>`'${k}': ...`).join(', ') + '}'}\ncur.execute(sql, params)\n${['read'].includes(el('method').value) ? 'rows = cur.fetchall()' : 'conn.commit()'}\ncur.close(); conn.close()`;
    } else {
        // sqlite3 in Python nutzt immer '?', named ':name'
        const finalSQL = sql; // kompatibel
        code = `# mit sqlite3 (Standardbibliothek)\nimport sqlite3\ncon = sqlite3.connect('app.db')\ncon.row_factory = sqlite3.Row\ncur = con.cursor()\nsql = ${JSON.stringify(finalSQL)}\nparams = ${Array.isArray(paramObj) ? '[' + paramObj.map(()=>"...").join(', ') + ']' : '{' + Object.keys(paramObj).map(k=>`'${k}': ...`).join(', ') + '}'}\ncur.execute(sql, ${Array.isArray(paramObj) ? 'params' : '**params'})\n${['read'].includes(el('method').value) ? 'rows = cur.fetchall()' : 'con.commit()'}\ncur.close(); con.close()`;
    }
    }
    else if(language === 'Go'){
    if(dbType === 'MySQL'){
        code = `// mit Go sql + MySQL Treiber\nimport (\n  "database/sql"\n  _ "github.com/go-sql-driver/mysql"\n  "log"\n)\n\nfunc main() {\n  db, err := sql.Open("mysql", "user:pass@tcp(localhost:3306)/test")\n  if err != nil { log.Fatal(err) }\n  defer db.Close()\n\n  sqlStr := ${JSON.stringify(sql)}\n  params := []interface{}{ /* TODO: Werte einsetzen */ }\n\n  rows, err := db.Query(sqlStr, params...)\n  if err != nil { log.Fatal(err) }\n  defer rows.Close()\n}`;
    } else { // SQLite
        code = `// mit Go sql + SQLite Treiber\nimport (\n  "database/sql"\n  _ "github.com/mattn/go-sqlite3"\n  "log"\n)\n\nfunc main() {\n  db, err := sql.Open("sqlite3", "app.db")\n  if err != nil { log.Fatal(err) }\n  defer db.Close()\n\n  sqlStr := ${JSON.stringify(sql)}\n  params := []interface{}{ /* TODO: Werte einsetzen */ }\n\n  rows, err := db.Query(sqlStr, params...)\n  if err != nil { log.Fatal(err) }\n  defer rows.Close()\n}`;
    }
    }

    return { meta, code, params: paramObj };
};

const build = () => {
    const language = el('language').value;
    const dbType = el('dbType').value;
    const method = el('method').value;
    const placeholder = el('placeholder').value;
    const table = el('table').value.trim();
    const selects = el('selectCols').value.split(',').map(s=>s.trim()).filter(Boolean);
    const orderBy = el('orderBy').value.trim();
    const limit = el('limit').value.trim();

    if(!table){
    el('sqlOut').textContent = 'Bitte einen Tabellennamen angeben.';
    el('paramsOut').textContent = '';
    el('codeOut').textContent = '';
    el('snippetMeta').textContent = '–';
    return;
    }

    const setRows = getRows(setList);
    const whereRows = getRows(whereList);

    let sql = '';
    if(method === 'create'){
    if(!setRows.length){ el('sqlOut').textContent = 'Für INSERT mindestens eine Spalte angeben.'; return; }
    sql = q.create({table, sets: setRows, placeholder});
    }
    if(method === 'read'){
    sql = q.read({table, selects, wheres: whereRows, orderBy, limit, placeholder});
    }
    if(method === 'update'){
    if(!setRows.length){ el('sqlOut').textContent = 'Für UPDATE mindestens eine SET‑Spalte angeben.'; return; }
    sql = q.update({table, sets: setRows, wheres: whereRows, placeholder});
    }
    if(method === 'delete'){
    sql = q.delete({table, wheres: whereRows, placeholder});
    }

    const { meta, code, params } = buildSnippet({language, dbType, placeholder, sql, setRows, whereRows});

    el('sqlOut').textContent = sql;
    el('paramsOut').textContent = (typeof params === 'string') ? params : JSON.stringify(params, null, 2);
    el('codeOut').textContent = code;
    el('snippetMeta').textContent = meta;
};

el('generateBtn').addEventListener('click', build);