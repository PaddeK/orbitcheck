# orbitcheck

Checks every EPUB in your [BookOrbit](https://bookorbit.app) library against the EPUB specification with
[epubveri](https://github.com/veripublica/epubveri), and shows the result on each book in BookOrbit.

```
BookOrbit ──(new or changed EPUBs)──▶ orbitcheck: epubveri ──(custom fields)──▶ BookOrbit
                                              ├──▶ report pages: every finding with code, file and line
                                              └──▶ epubsana: proposed fixes, repaired copy to download
```

BookOrbit accepts any EPUB that is a ZIP file; it does not validate them. A broken EPUB uploads fine and only
causes trouble later, in a reader or on an e-reader. orbitcheck runs next to BookOrbit and catches these:
a missing file, a broken table of contents, invalid XHTML, wrong media types, and everything else epubcheck
reports. epubveri is a pure-Rust, JVM-free alternative to the W3C's epubcheck with the same message codes
(`RSC-005`, `OPF-030`, …), compiled to WebAssembly, so there is no Java in the image.

How it works:

1. **List** the books in BookOrbit every few minutes and pick out their EPUB files.
2. **Check** each new or changed EPUB (by size) with epubveri: it is downloaded, validated in memory, and dropped.
   For a book with findings, [epubsana](https://github.com/veripublica/epubsana) plans its repair on the same
   copy and tries the fixes that are safe to apply without asking, together with orbitcheck's own fixes and the
   epublift upgrade if they are turned on (see below). A new version of a tool checks every book again.
3. **Write** the verdict to four custom fields of the book in BookOrbit, which orbitcheck creates on its first run:

   | Field | Type | Value |
   |---|---|---|
   | EPUB check | text | `valid`, `warnings`, `errors`, `fatal`, or `not checked` (e.g. too large) |
   | EPUB errors | number | errors, including fatal ones |
   | EPUB warnings | number | warnings |
   | EPUB report | link | the book's report page (only with `REPORT_URL`) |

   Fields are only written when a value changes. With several EPUBs in one book, the worst status and the summed
   counts win. You can filter and sort your library by these fields like by built-in ones, e.g. *EPUB errors
   greater than 0*.
4. **Serve** the report pages on port 8080: an overview of all books with problems, and per book every finding
   with its severity, code, place in the EPUB and message.
5. **Repair on request.** Below the findings, a book's page lists every fix epubsana proposes, with its reason and
   the exact edits. Safe fixes are ticked; fixes that change something visible (dropping a missing image,
   repointing a link) wait for you to tick them. *Check selection* shows what your choice achieves and which
   findings remain; *Download repaired EPUB* sends you `<name>_fixed.epub`. epubsana undoes any fix that made the
   book worse.

orbitcheck doesn't change books in BookOrbit unless you turn on `REPLACE_IN_LIBRARY` and press a button; by default
repairs only touch the copy you download. epubsana fixes the defects that have exactly one correct repair; the rest
(like a broken link whose target is unclear) is a job for Sigil or calibre.

## Quick start

### 1. BookOrbit

orbitcheck logs in like BookOrbit's apps do, with a normal BookOrbit user (not KOReader credentials). An admin
works; a user of its own is tidier. It needs access to the libraries to check and these permissions:

- **download** (`library_download`), to read the files,
- **edit metadata** (`library_edit_metadata`), to set the custom fields. BookOrbit also requires the Editor or
  Owner role on each library for that (*Settings → Libraries → Access*),
- **manage libraries** (`manage_libraries`), only to create the custom fields on the first run. Without it, create
  the fields from the table above yourself (same labels and types), and orbitcheck uses them.

### 2. orbitcheck

```sh
docker run -d --name orbitcheck --restart unless-stopped -v orbitcheck-data:/data -p 8080:8080 \
  -e BOOKORBIT_URL=https://books.example.org -e BOOKORBIT_USER=… -e BOOKORBIT_PASSWORD=… \
  -e REPORT_URL=http://192.168.1.10:8080 -e REPORT_PASSWORD=… \
  ghcr.io/paddek/orbitcheck:latest
docker logs -f orbitcheck
```

Or add it to the stack that runs BookOrbit, see [`compose.example.yaml`](compose.example.yaml).
To see the results first without changing anything in BookOrbit, start it with `DRY_RUN=true`: books are still
checked and the report pages work.

A healthy start looks like this:

```
orbitcheck 0.1.0 with epubveri 0.35.0+16d7735 and epubsana 0.36.0+73dd926, checking every 300s
BookOrbit: logged in as reader
reports on port 8080 (login required), linked in BookOrbit as http://192.168.1.10:8080
created custom field "EPUB check" in BookOrbit
created custom field "EPUB errors" in BookOrbit
created custom field "EPUB warnings" in BookOrbit
created custom field "EPUB report" in BookOrbit
checked "Moby Dick": valid
checked "Moby Dick; or, The Whale": 2 errors; epubsana proposes 2 fix(es)
cycle done: 2 book(s) with EPUBs, 2 checked, 2 updated in BookOrbit
```

The first run checks the whole library; epubveri and epubsana take milliseconds per book, so downloading is what
takes the time.
Images are built for amd64 and arm64. `latest` follows the main branch; releases are also tagged by version
(`1.2.3`, `1.2`, `1`). To build the image yourself: `docker build -t orbitcheck https://github.com/PaddeK/orbitcheck.git`.

## Configuration

Every variable can also be read from a file by appending `_FILE` to its name (e.g. `BOOKORBIT_PASSWORD_FILE=/run/secrets/bookorbit_password`),
for Docker secrets.

| Variable | Default | Purpose |
|---|---|---|
| `BOOKORBIT_URL` | required | BookOrbit base URL, without `/api/…`. |
| `BOOKORBIT_USER` | required | BookOrbit username, see above. |
| `BOOKORBIT_PASSWORD` | required | Its password. |
| `BOOKORBIT_PUBLIC_URL` | `BOOKORBIT_URL` | Where your browser reaches BookOrbit, for the links on the report pages. Set it when `BOOKORBIT_URL` is an internal address such as `http://bookorbit:3000`. |
| `REPORT_URL` | none | The address your browser reaches orbitcheck's port at. Each book in BookOrbit then links to its report page. Without it, there is no *EPUB report* field; the pages still work. |
| `PORT` | `8080` | Port of the report pages. |
| `REPORT_PASSWORD` | none | Password for the report pages (HTTP basic auth). Recommended: the pages can download books from your library. `/healthz` stays open. |
| `REPORT_USER` | `orbitcheck` | User name for the report pages, with `REPORT_PASSWORD`. |
| `CHECK_INTERVAL` | `300` | Seconds between looking for new and changed books (at least 60). |
| `MAX_FILE_SIZE_MB` | `200` | Bigger EPUBs are not downloaded and show as `not checked`. epubveri and epubsana hold the whole file in memory. |
| `DRY_RUN` | `false` | `true`: check books, but create and set no custom fields in BookOrbit. |
| `ORBITCHECK_FIXES` | `false` | `true`: offer orbitcheck's own fixes for defects epubsana does not repair, see below. |
| `EPUBLIFT` | `false` | `true`: offer upgrading EPUB 2 books to EPUB 3 with epublift (included in the image), see below. |
| `EPUBLIFT_PATH` | `epublift` | The epublift program, outside the image: a path, or a name looked up in `PATH`. |
| `REPLACE_IN_LIBRARY` | `false` | `true`: offer to replace books in the library with their repaired version, see below. Needs the library mounted read-write. Off in a dry run. |
| `DATA_DIR` | `/data` | Where `state.json` and the reports are kept. |

`state.json` holds the BookOrbit session, the size and result of each checked file and the values last written.
`reports/` holds the findings and epubsana's plan for each file; repaired books are made on request and never stored. Deleting both is safe: every book is checked again, and changed
values are written once more.

The image is a single compiled executable on [distroless](https://github.com/GoogleContainerTools/distroless)
(amd64 and arm64): no shell, so `docker exec … sh` won't work; `docker logs` is where to look.
It runs as uid `1000`. A named volume just works; for a bind mount, give the host directory to that user
(`sudo chown 1000:1000 /path/on/host`), otherwise the container exits with a hint saying exactly that.
The container reports itself unhealthy when no check cycle has succeeded, and no book was checked, for two intervals.

### orbitcheck's own fixes

epubsana fixes the defects it can be certain about, and declines the rest. Some common ones it does not cover have
exactly one correct repair too; with `ORBITCHECK_FIXES=true` orbitcheck offers its own, marked *orbitcheck* in the list
of fixes. Each looks for exactly one pattern and leaves everything else alone:

| Fix | Repair | |
|---|---|---|
| A `dcterms:modified` with fractions of a second (`2026-10-24T04:01:37.489Z`) | Drop the fraction | safe |
| EPUB 2 attributes on metadata in an EPUB 3 package (`opf:scheme`, `opf:role`, `opf:file-as`, under any prefix) | Move the value into the EPUB 3 form, `<meta refines="#id" property="identifier-type\|role\|file-as">` | safe; left alone where an EPUB 3 refinement says something else |
| `<meta refines="#id">` of an element that does not exist any more | Remove it | safe |
| Amazon conversion leftovers (`data-AmznRemoved…`) | Remove them, unless a stylesheet uses them | safe |
| `<link rel="stylesheet">` to a file that is not in the book | Remove the link: a missing stylesheet styles nothing | safe |
| Page-list entries (NCX and navigation document) whose page markers are not in the book | Remove them; renumber the NCX's `playOrder` | safe |
| An empty `<guide>` | Remove it | safe |
| BookOrbit's EPUB 3 series metas in an EPUB 2 package (`belongs-to-collection`) | Remove them where `calibre:series` says the same; otherwise move the series there | safe, or to confirm |

The first three and the last are produced by BookOrbit's *Write metadata to files*, the first and the last in nearly
every book it writes. Only the files a fix names change; every other file in the EPUB is copied byte for byte.

### Upgrading EPUB 2 books to EPUB 3 (epublift)

Many EPUB 2 books, especially conversions of Kindle books, contain markup only EPUB 3 allows: `epub:type`, `role`,
`<section>`, `<nav>`. Stripping it would lose information; upgrading the book to EPUB 3 makes it valid. With
`EPUBLIFT=true`, [epublift](https://github.com/ePubLift/epublift) does that: package version 3.0, an EPUB 3 navigation
document (the EPUB 2 table of contents stays for older readers), documents declared as HTML5. Afterwards orbitcheck's
own fixes run again on the upgraded book, since some leftovers (such as Amazon's) only become fixable then.

The upgrade changes the book's format version, so it is always a fix to confirm, never part of *replace with safe
fixes*. It is only offered where it makes the book better: orbitcheck tries it while checking the book, and
epublift 4.5.1 sometimes leaves `valign` or `cellspacing` behind when the book's CSS sets the same property, which
EPUB 3 does not allow.

### How fixes are applied

epubsana's fixes first, on the book as it is; then orbitcheck's own, one at a time; then the epublift upgrade. Each of
orbitcheck's steps is undone again unless it lowers the number of errors without making any kind of error more
frequent, as epubsana does with its own. The result shows what happened to each fix.

### Replacing books in the library

By default orbitcheck never changes your library: repairs only touch the copy you download. With
`REPLACE_IN_LIBRARY=true`, two more buttons appear:

- **Replace in BookOrbit** on a book's page, next to *Download repaired EPUB*: the book in your library becomes the
  repaired version, with the fixes you ticked.
- **Replace N books in BookOrbit with their safe fixes** on the overview: every book whose safe fixes remove errors
  gets exactly those, after a confirmation page listing them. It runs in the background; the page shows the progress.
- **Your own fixed version** on a book's page, for what no tool fixes automatically: download the current file, repair
  it in Sigil or calibre, and upload it. orbitcheck checks the upload and shows its findings next to the library's,
  pointing out a different title inside the book or more errors than before; only after you confirm does it replace the
  book. Unconfirmed uploads are deleted after an hour.

orbitcheck writes the file where BookOrbit has it, so mount the library into orbitcheck **at the same path as in the
BookOrbit container**, read-write, writable for uid 1000:

```yaml
    volumes:
      - orbitcheck-data:/data
      - /path/to/books:/books   # the same mount as BookOrbit's
    environment:
      REPLACE_IN_LIBRARY: "true"
```

What happens on a replacement:

1. The file on disk must be byte for byte the one BookOrbit served and orbitcheck repaired; if it changed in the
   meantime, nothing is replaced.
2. The original goes to `DATA_DIR/backups/<file ID>/` in orbitcheck's volume. To restore one:
   `docker cp orbitcheck:/data/backups/<file ID>/<name> /path/to/books/…`.
3. The repaired book is written next to the original (a hidden `.orbitcheck-tmp` file BookOrbit ignores) and renamed
   over it, so BookOrbit never sees half a book.
4. orbitcheck asks BookOrbit to scan the library (this needs the *manage libraries* permission; otherwise the change
   shows up with BookOrbit's next scan). The file keeps its ID in BookOrbit, so reading progress, annotations and
   bookmarks stay with the book; its old hash moves to the file's hash history, so copies already on e-readers keep
   matching for KOReader sync.

Replacing a file keeps its name and place. Most fixes only touch the package files (OPF, NCX), and the text stays where
it was. Fixes inside a chapter (for example wrapping stray text in a `<div>`) change its structure, so an exact
position in that chapter, like a highlight, can end up slightly off; percentage progress is not affected.

## Limitations

- **Changes are noticed by file size.** A file replaced by one of exactly the same size is not checked again
  (deleting `state.json` checks everything).
- **"Write metadata to files" in a library's settings** makes BookOrbit write metadata, custom fields included,
  into the book file whenever metadata is saved, so also when orbitcheck sets its fields. That changes the
  EPUB; orbitcheck checks it once more and then leaves it alone. The setting is off by default.
- Only EPUB files are checked; KEPUB and other formats are skipped.

## Security

- **Set `REPORT_PASSWORD`.** Without it the report pages have no login, and anyone who can reach the port can
  see titles and findings, and download (repaired copies of) the EPUBs that have findings, using orbitcheck's
  BookOrbit access. With it, every page asks for the login; use HTTPS (a reverse proxy) if the port is reachable
  from outside your network, since basic auth sends the password with every request.
- **The BookOrbit password** is only sent to BookOrbit. orbitcheck keeps a session like BookOrbit's apps
  (shown as *orbitcheck* among the user's sessions) in `state.json` (mode `0600`), so it does not log in on every
  run. Revoking the session there makes orbitcheck log in again with the password.

## Development

Requires [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
bun test            # unit and integration tests (fake BookOrbit and generated EPUBs included)
bun run typecheck
bun run build       # standalone executable in dist/, as used in the Docker image

# One cycle against a real BookOrbit, changing nothing (state in ./data)
BOOKORBIT_URL=… BOOKORBIT_USER=… BOOKORBIT_PASSWORD=… DRY_RUN=true bun run once
```

Layout: `src/check.ts` is the check cycle, `src/validator.ts` and `src/repairer.ts` wrap epubveri and epubsana,
`src/fixes.ts` holds orbitcheck's own fixes (`src/series.ts` the one for BookOrbit's series metas) with `src/zip.ts`
to rewrite files inside an EPUB, `src/epublift.ts` runs epublift,
`src/replace.ts` replaces books in the library,
`src/wasm.ts` loads their WebAssembly (Bun can't import `.wasm` modules the way the packages expect, so they are
instantiated by hand and embedded into the executable), `src/bookorbit.ts` is the API client, `src/report.ts` the
report pages and repair downloads, `src/config.ts` the environment variables, `src/state.ts` the state file and
`src/index.ts` the entry point with the loop and `--healthcheck`.

## License

[AGPL-3.0](LICENSE), the license of epubveri, epubsana and epublift, which the image includes.
