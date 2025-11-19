import zipfile

from app.pdf_extractor import (
    build_zip_from_sources,
    extract_sources_from_pages,
)


def test_extract_sources_from_pages_detects_filename_and_code():
    sample_text = """Lesson 01 - Animal.java
Some overview text
package zoo;
public class Animal {
    private final String name;
}
"""
    sources = extract_sources_from_pages([sample_text])
    assert "Animal.java" in sources
    assert sources["Animal.java"].startswith("package zoo;")


def test_extract_sources_from_pages_generates_unique_names():
    text = """Page header Cat.java
import java.util.*;
class Cat {}
"""
    sources = extract_sources_from_pages([text, text])
    assert set(sources.keys()) == {"Cat.java", "Cat_2.java"}


def test_extract_sources_from_pages_strips_headers_and_line_numbers():
    text = """UseTestScore5.java Page 1/1
Printed: 2025/11/11, 2:14:00 Printed for: Shinzo SAITO
1 package example;
2 
3 public class Foo {
10     public static void main(String[] args) {
11         System.out.println("ok");
12     }
13 }
"""
    sources = extract_sources_from_pages([text])
    source = sources["UseTestScore5.java"]
    assert "UseTestScore5" not in source
    assert source.startswith("package example;")
    assert "public static void main" in source
    assert "        System.out" in source


def test_build_zip_from_sources_contains_entries(tmp_path):
    sources = {
        "Foo.java": "public class Foo {}\n",
        "Bar.java": "class Bar {}\n",
    }
    zip_bytes = build_zip_from_sources(sources)
    zip_path = tmp_path / "out.zip"
    zip_path.write_bytes(zip_bytes)
    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
        assert names == set(sources.keys())
        foo = zf.read("Foo.java").decode()
        assert "class Foo" in foo
