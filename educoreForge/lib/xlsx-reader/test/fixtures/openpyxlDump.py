import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], read_only=False)
out = open(sys.argv[2], 'w')
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if c.value is None: continue
            v = c.value
            out.write(json.dumps({'sheet': ws.title, 'ref': c.coordinate, 'pyType': type(v).__name__, 'value': v if isinstance(v,(str,int,float,bool)) else str(v)}, ensure_ascii=False) + '\n')
