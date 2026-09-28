#!/usr/bin/env python3
"""Import EPUB books as self-contained HTML pages for the Labook reader.

Usage: python3 scripts/import_epub.py INPUT_DIR OUTPUT_DIR
Requires beautifulsoup4 and lxml. Original EPUB files are read only.
"""

from __future__ import annotations

import argparse
import base64
import html
import mimetypes
import posixpath
import re
import warnings
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile

from bs4 import BeautifulSoup, Comment, NavigableString, Tag, XMLParsedAsHTMLWarning
from lxml import etree


ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "05-商业与企业" / "从0到1.html"
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

# The source metadata for some editions appends marketing copy to the title or
# lists translators as authors. Keep the catalog labels faithful to the books.
BOOK_LABELS = {
    "HelloKitty的秘密": ("Hello Kitty的秘密", "肯·贝尔森 / 布莱恩·布莱纳"),
    "一生的旅程迪士尼CEO自述批量打造超级IP的经营哲学": ("一生的旅程：迪士尼CEO自述批量打造超级IP的经营哲学", "罗伯特·艾格 / 乔尔·洛弗尔"),
    "乐高工作法": ("乐高工作法", "佩尔·克里斯蒂安森 / 罗伯特·拉斯穆森"),
    "乐高玩出奇迹": ("乐高，玩出奇迹", "尼尔斯·隆德"),
    "乐高：创新者的世界": ("乐高：创新者的世界", "戴维·罗伯逊 / 比尔·布林"),
    "创新公司：皮克斯的启示": ("创新公司：皮克斯的启示", "艾德·卡特姆 / 埃米·华莱士"),
    "可爱狂潮为何凯蒂猫能席卷全球": ("可爱狂潮：为何凯蒂猫能席卷全球？", "克里斯汀·R.亚诺"),
    "玩潮快乐即正义": ("玩潮：快乐即正义", "造梦九局"),
    "迪士尼大学：打造世界一流员工团队的传奇": ("迪士尼大学：打造世界一流员工团队的传奇", "道格·李普"),
    "迪士尼魔法：从童话城堡到娱乐王国的经营之道": ("迪士尼魔法：从童话城堡到娱乐王国的经营之道", "比尔·卡波达戈利 / 林恩·杰克逊"),
}


def xml_nodes(node, name):
    return node.xpath(f'.//*[local-name()="{name}"]')


def zip_path(base: str, relative: str) -> str:
    return posixpath.normpath(posixpath.join(posixpath.dirname(base), unquote(relative)))


def clean_label(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def document_parts(epub: ZipFile):
    container = etree.fromstring(epub.read("META-INF/container.xml"))
    opf_path = xml_nodes(container, "rootfile")[0].get("full-path")
    opf = etree.fromstring(epub.read(opf_path))
    items = {item.get("id"): item for item in xml_nodes(opf, "manifest")[0] if item.get("id")}
    spine = [zip_path(opf_path, items[ref.get("idref")].get("href")) for ref in xml_nodes(opf, "spine")[0]]
    ncx_item = next(item for item in items.values() if item.get("media-type") == "application/x-dtbncx+xml")
    ncx_path = zip_path(opf_path, ncx_item.get("href"))
    ncx = etree.fromstring(epub.read(ncx_path))
    toc = []
    for point in xml_nodes(ncx, "navPoint"):
        label_node = xml_nodes(point, "navLabel")
        label = clean_label("".join(label_node[0].itertext())) if label_node else "正文"
        src = xml_nodes(point, "content")[0].get("src")
        file_part, _, fragment = src.partition("#")
        toc.append({
            "file": zip_path(ncx_path, file_part),
            "fragment": unquote(fragment),
            "title": label,
            "depth": len(point.xpath('ancestor::*[local-name()="navPoint"]')),
        })
    title_node = xml_nodes(opf, "title")
    creator_nodes = xml_nodes(opf, "creator")
    metadata_title = clean_label("".join(title_node[0].itertext())) if title_node else "未命名"
    metadata_author = " / ".join(clean_label("".join(node.itertext())) for node in creator_nodes)
    cover_id = next((node.get("content") for node in xml_nodes(opf, "meta") if node.get("name") == "cover"), None)
    cover_item = items.get(cover_id) if cover_id else next((item for item in items.values() if "cover-image" in (item.get("properties") or "")), None)
    cover_href = cover_item.get("href") if cover_item is not None else None
    return spine, toc, metadata_title, metadata_author, opf_path, cover_href


def first_heading(elements: list[Tag]) -> str:
    for element in elements[:5]:
        if re.fullmatch(r"h[1-6]", element.name or ""):
            return clean_label(element.get_text(" ", strip=True))
    return ""


def section_group(title: str, started_body: bool) -> str:
    if re.match(r"^(?:封面|扉页|版权|目录|献给|推荐|自序|序言|序\b|前言|引言)", title, re.I):
        return "开篇" if not started_body else "正文"
    if re.match(r"^(?:后记|附录|致谢|注释|参考|作者|索引|尾声)", title):
        return "附录" if started_body else "开篇"
    return "正文"


def image_data(epub: ZipFile, source_file: str, src: str) -> str:
    if src.startswith("data:") or re.match(r"^[a-z][a-z0-9+.-]*:", src, re.I):
        return src
    path = zip_path(source_file, src.split("#", 1)[0])
    data = epub.read(path)
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    if not mime.startswith("image/"):
        raise ValueError(f"Not an image: {path}")
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def rewrite_document(epub: ZipFile, source_file: str, file_index: int, spine_index: dict[str, int], soup: BeautifulSoup):
    body = soup.body or soup
    for tag in body.find_all(["script", "style", "link"]):
        tag.decompose()
    for comment in body.find_all(string=lambda value: isinstance(value, Comment)):
        comment.extract()
    original_ids = {}
    for tag in body.find_all(True):
        original = tag.get("id") or tag.get("name")
        if original:
            original_ids.setdefault(original, tag)
            tag["id"] = f"epub-{file_index}-{original}"
            if tag.has_attr("name"):
                del tag["name"]
        if tag.name == "img" and tag.get("src"):
            tag["src"] = image_data(epub, source_file, tag["src"])
            tag.attrs.pop("srcset", None)
            tag.attrs.pop("width", None)
            tag.attrs.pop("height", None)
        if tag.name == "image":
            attr = "xlink:href" if tag.get("xlink:href") else "href"
            if tag.get(attr):
                tag[attr] = image_data(epub, source_file, tag[attr])
        if tag.name == "a" and tag.get("href"):
            href = tag["href"]
            if re.match(r"^(?:https?:|mailto:|tel:)", href, re.I):
                scheme = urlsplit(href).scheme
                tag["href"] = scheme.lower() + href[len(scheme):]
                tag["rel"] = "noopener noreferrer"
                continue
            parsed = urlsplit(href)
            if parsed.scheme:
                continue
            target_file = zip_path(source_file, parsed.path) if parsed.path else source_file
            target_index = spine_index.get(target_file)
            if target_index is not None:
                tag["href"] = f"#epub-{target_index}-{unquote(parsed.fragment)}" if parsed.fragment else f"#book-{target_index}-1"
            elif target_file in epub.namelist() and (mimetypes.guess_type(target_file)[0] or "").startswith("image/"):
                tag["href"] = image_data(epub, source_file, href)
            else:
                tag.attrs.pop("href", None)
                tag["title"] = "原书附件未收录"
    return body, original_ids


def split_sections(body, source_file: str, file_index: int, toc_for_file, original_ids):
    children = [child for child in body.contents if isinstance(child, Tag) or (isinstance(child, NavigableString) and child.strip())]
    if not children:
        return []
    boundaries = {}
    for entry in toc_for_file:
        target = original_ids.get(entry["fragment"]) if entry["fragment"] else children[0]
        if target is None:
            raise ValueError(f"Missing TOC anchor {source_file}#{entry['fragment']}")
        while target.parent is not body:
            target = target.parent
            if target is None:
                raise ValueError(f"TOC anchor outside body: {source_file}#{entry['fragment']}")
        boundaries.setdefault(id(target), entry)
    if id(children[0]) not in boundaries:
        boundaries[id(children[0])] = {"title": "", "depth": 0}
    sections = []
    current = []
    current_entry = None
    for child in children:
        if id(child) in boundaries:
            if current:
                sections.append((current_entry, current))
            current_entry = boundaries[id(child)]
            current = []
        current.append(child)
    if current:
        sections.append((current_entry, current))
    result = []
    for number, (entry, elements) in enumerate(sections, 1):
        title = (entry or {}).get("title") or first_heading(elements)
        if not title and file_index == 0 and "cover" in source_file.lower():
            title = "封面"
        if not title:
            title = "插图" if all(not x.get_text(" ", strip=True) for x in elements if isinstance(x, Tag)) else "正文"
        content = "".join(str(element) for element in elements)
        if not BeautifulSoup(content, "lxml").get_text(" ", strip=True) and "<img" not in content and "<image" not in content:
            continue
        result.append({"id": f"book-{file_index}-{number}", "title": title, "depth": (entry or {}).get("depth", 0), "html": content})
    return result


def import_book(source: Path, destination: Path, style: str, script: str):
    with ZipFile(source) as epub:
        spine, toc, metadata_title, metadata_author, opf_path, cover_href = document_parts(epub)
        title, author = BOOK_LABELS.get(source.stem, (metadata_title, metadata_author))
        spine_index = {file: index for index, file in enumerate(spine)}
        by_file = defaultdict(list)
        for entry in toc:
            by_file[entry["file"]].append(entry)
        all_sections = []
        original_text = []
        for index, source_file in enumerate(spine):
            soup = BeautifulSoup(epub.read(source_file), "lxml")
            body, ids = rewrite_document(epub, source_file, index, spine_index, soup)
            original_text.append("".join(body.stripped_strings))
            all_sections.extend(split_sections(body, source_file, index, by_file[source_file], ids))
        if not all_sections:
            raise ValueError(f"No reading content in {source.name}")
        converted_text = "".join("".join(BeautifulSoup(section["html"], "lxml").stripped_strings) for section in all_sections)
        if converted_text != "".join(original_text):
            raise ValueError(f"Body text changed while importing {source.name}")
        if cover_href:
            cover = image_data(epub, opf_path, cover_href)
            if not any(cover in section["html"] for section in all_sections):
                all_sections.insert(0, {"id": "book-cover", "title": "封面", "depth": 0, "html": f'<img src="{cover}" alt="{html.escape(title, quote=True)} 封面">'})
        previous_title = None
        for section in all_sections:
            if section["title"] == "正文" and previous_title:
                section["title"] = f"{previous_title}（续）"
            if section["title"] not in ("正文", "插图") and not section["title"].endswith("（续）"):
                previous_title = section["title"]
        # The converted body keeps every spine document in its original order.
        word_count = sum(len(BeautifulSoup(section["html"], "lxml").get_text("", strip=True)) for section in all_sections)
        image_count = sum(section["html"].count("data:image/") for section in all_sections)
        esc = lambda value: html.escape(str(value), quote=True)
        toc_rows = []
        if all_sections[0]["title"] == "封面":
            toc_rows.append({"title": "封面", "id": all_sections[0]["id"], "depth": 0})
        for entry in toc:
            index = spine_index.get(entry["file"])
            if index is None:
                raise ValueError(f"TOC target outside reading spine: {entry['file']}")
            target = f"epub-{index}-{entry['fragment']}" if entry["fragment"] else f"book-{index}-1"
            if toc_rows and target == toc_rows[0]["id"]:
                continue
            toc_rows.append({"title": entry["title"], "id": target, "depth": entry["depth"]})
        if not toc_rows:
            toc_rows = [{"title": section["title"], "id": section["id"], "depth": section["depth"]} for section in all_sections]
        sidebar = []
        sections_by_group = []
        started_body = False
        for row in toc_rows:
            name = section_group(row["title"], started_body)
            if name == "正文":
                started_body = True
            if not sections_by_group or sections_by_group[-1][0] != name:
                sections_by_group.append((name, []))
            sections_by_group[-1][1].append(row)
        for name, rows in sections_by_group:
            links = "".join(
                f'<a class="toc-item toc-chapter{" toc-sub" if row["depth"] else ""}" href="#{esc(row["id"])}"><span>{esc(row["title"])}</span></a>'
                for row in rows
            )
            sidebar.append(f'<div class="toc-part" data-open="true"><button aria-expanded="true"><span class="caret">▾</span><span>{name}</span></button><div class="toc-children">{links}</div></div>')
        content = "\n".join(
            f'<section class="content-block" id="{esc(section["id"])}" data-title="{esc(section["title"])}">{section["html"]}</section>'
            for section in all_sections
        )
        display_count = f"约 {round(word_count / 1000)} 千字"
        full_title = f"{title} — {author}" if author else title
        body_html = f'''<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(full_title)}</title>
<style>{style}</style>
</head>
<body data-toc="closed">
<div class="bar">
  <button class="menu-btn" id="menuBtn" aria-label="目录">目录</button>
  <div class="brand"><b>{esc(title)}</b> <span class="author">{esc(author)}</span></div>
  <div class="spacer"></div>
  <div class="search"><input id="q" type="search" placeholder="搜全书…" aria-label="搜索全书"><kbd>/</kbd></div>
  <div class="controls">
    <div class="seg" role="group" aria-label="字号"><button id="fsDown" aria-label="减小字号">A−</button><button id="fsNow" tabindex="-1" aria-hidden="true" style="cursor:default">17</button><button id="fsUp" aria-label="增大字号">A+</button></div>
    <div class="seg" role="group" aria-label="配色"><button data-theme-btn="light" aria-pressed="true">昼</button><button data-theme-btn="warm" aria-pressed="false">暖</button><button data-theme-btn="night" aria-pressed="false">夜</button></div>
  </div>
</div>
<div class="progress" id="progress"></div>
<nav class="toc" aria-label="目录">{''.join(sidebar)}<div class="toc-foot">{len(all_sections)} 节 · {display_count}<br>{image_count} 张插图 · / 搜索<br>[ ] 上下章节</div></nav>
<div class="wrap"><div class="sheet"><div class="col">
  <header class="title-page"><p class="kicker">LABOOK · 阅读</p><h1>{esc(title)}</h1><p class="attrib">{esc(author)}</p><div class="stats"><span>{len(all_sections)} 节</span><span>{display_count}</span><span>{image_count} 张插图</span></div></header>
  {content}
  <div class="end"><span>全书完</span><span>{esc(title)}</span></div>
</div></div></div>
<aside class="results" id="results" hidden><div class="rhead" id="rhead"></div><div id="rlist"></div></aside>
<div class="resume" id="resume" hidden><span>上次读到 <b id="resumeTitle"></b></span><button class="tool" id="resumeGo">继续</button><button class="x" id="resumeX" aria-label="关闭">✕</button></div>
<button class="totop" id="totop">回到顶部</button>
<script>{script.replace('"z01:"+k', '"epub:' + source.stem + ':"+k')}</script>
</body>
</html>'''
        destination.mkdir(parents=True, exist_ok=True)
        output = destination / f"{title}.html"
        output.write_text(body_html, encoding="utf-8")
        print(f"{source.name} -> {output}: {len(all_sections)} sections, {word_count} characters, {image_count} images")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    template = TEMPLATE.read_text(encoding="utf-8")
    style = re.search(r"<style>([\s\S]*?)</style>", template).group(1)
    style += '''
.content-block {scroll-margin-top:calc(var(--bar) + 24px)}
.content-block h1,.content-block h5,.content-block h6{font-family:var(--sans);color:var(--accent);line-height:1.5;scroll-margin-top:calc(var(--bar) + 24px)}
.content-block h1{font-size:1.5em;margin:3em 0 1em}.content-block h5,.content-block h6{font-size:1em;margin:1.6em 0 .7em}
.content-block figure{margin:1.5em 0}.content-block figcaption{text-align:center;color:var(--muted);font:12px/1.7 var(--sans)}
.content-block img{object-fit:contain}.content-block svg{max-width:100%;height:auto}
.content-block a[href]{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.content-block li{margin:.45em 0}.content-block ul,.content-block ol{padding-left:1.6em}
.content-block pre{white-space:pre-wrap;overflow-wrap:anywhere}.content-block hr{border:0;border-top:1px solid var(--rule);margin:2em 0}
.content-block [align="center"]{text-align:center}.content-block [align="right"]{text-align:right}
.content-block [class*="center"]{text-align:center}.content-block [class*="Center"]{text-align:center}
'''
    script = re.findall(r"<script>([\s\S]*?)</script>", template)[-1]
    epubs = sorted(args.input_dir.glob("*.epub"))
    if not epubs:
        parser.error("No EPUB files found")
    for epub in epubs:
        import_book(epub, args.output_dir, style, script)


if __name__ == "__main__":
    main()
