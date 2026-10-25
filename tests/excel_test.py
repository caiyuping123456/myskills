import json
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'skills' / 'boss-job-apply' / 'scripts' / 'export-excel.mjs'
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

class ExcelExportTests(unittest.TestCase):
    def make_progress(self, folder: Path) -> Path:
        data = {
            'applied': 1,
            'checked': ['/job_detail/a.html', '/job_detail/b.html'],
            'results': [
                {'company':'A&B<科技>','title':'Java实习生','salary':'200-300元/天','city':'深圳','size':'20-99人','education':'本科','href':'/job_detail/a.html','outcome':'sent-verified','attemptedAt':'2026-10-25T01:00:00Z'},
                {'company':'B','title':'Java开发','salary':'150-180元/天','city':'广州','size':'20-99人','education':'本科','href':'/job_detail/b.html','skipped':'salary'},
            ],
        }
        path = folder / 'apply-progress.json'
        path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        return path

    def test_writes_valid_xlsx_with_required_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            progress = self.make_progress(folder)
            output = folder / 'summary.xlsx'
            result = subprocess.run(['node', str(SCRIPT), str(progress), '--output', str(output), '--no-prompt'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(output.exists())
            with zipfile.ZipFile(output) as archive:
                names = set(archive.namelist())
                self.assertTrue({'[Content_Types].xml','xl/workbook.xml','xl/worksheets/sheet1.xml','xl/styles.xml'} <= names)
                sheet = archive.read('xl/worksheets/sheet1.xml').decode('utf-8')
            root = ET.fromstring(sheet)
            rows = root.findall(f'.//{NS}row')
            self.assertEqual(len(rows), 3)
            values = [''.join(c.itertext()) for c in rows[1].findall(f'{NS}c')]
            self.assertIn('A&B<科技>', values)
            self.assertIn('已投递（已确认）', values)
            self.assertIn('200-300元/天', values)

    def test_non_interactive_without_output_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            progress = self.make_progress(folder)
            result = subprocess.run(['node', str(SCRIPT), str(progress)], capture_output=True, text=True, stdin=subprocess.DEVNULL)
            self.assertEqual(result.returncode, 3)
            self.assertIn('--output', result.stderr)
            self.assertEqual(list(folder.glob('*.xlsx')), [])

if __name__ == '__main__':
    unittest.main()
