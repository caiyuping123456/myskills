import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import unittest
ROOT = Path(__file__).resolve().parents[1]

class PackageTests(unittest.TestCase):
    def test_two_bundles_and_private_file_exclusions(self):
        spec = importlib.util.spec_from_file_location('packaging', ROOT / 'scripts/package_artifacts.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with TemporaryDirectory() as tmp:
            repo = Path(tmp) / 'repo'
            a = repo / 'skills/demo'
            b = repo / 'chrome-extensions/demo'
            a.mkdir(parents=True); b.mkdir(parents=True)
            (a / 'SKILL.md').write_text('demo')
            (a / 'scripts').mkdir()
            (a / 'scripts/config.example.json').write_text('{}')
            (a / 'scripts/config.json').write_text('secret')
            (b / 'manifest.json').write_text('{}')
            (b / '.codex').mkdir(); (b / '.codex/private').write_text('secret')
            (a / 'out').mkdir(); (a / 'out/history.json').write_text('private')
            (a / 'profile').mkdir(); (a / 'profile/Cookies').write_text('private')
            output = Path(tmp) / 'dist'
            files = module.package(repo, output)
            self.assertEqual({p.name for p in files}, {'skill-demo.zip','skill-demo-flat.zip','chrome-extension-demo.zip'})
            with ZipFile(output / 'skill-demo.zip') as z:
                self.assertEqual(set(z.namelist()), {'demo/SKILL.md','demo/scripts/config.example.json'})
            with ZipFile(output / 'skill-demo-flat.zip') as z:
                self.assertEqual(set(z.namelist()), {'SKILL.md','scripts/config.example.json'})
            with ZipFile(output / 'chrome-extension-demo.zip') as z:
                self.assertEqual(z.namelist(), ['manifest.json'])

if __name__ == '__main__':
    unittest.main()
