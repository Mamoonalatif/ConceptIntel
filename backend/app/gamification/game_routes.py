"""HTTP surface for the concept-game feature of the Gamification module: a student
picks a knowledge-graph concept, the model authors a whole playable page for it
(app/gamification/game_service.py), and that page is served back to the browser.

WHY THE HTML IS STORED AND SERVED, NOT STREAMED TO THE CLIENT
------------------------------------------------------------
The alternative - return the generated markup in the JSON response and let the
frontend inject it - was rejected. Authoring a page is the most expensive call in
this project, so a replay must not re-bill it; a student who replays should get
the *same* game they were learning with; and a teacher should be able to inspect
after the fact what a student was actually shown. Persisting to GeneratedGame and
serving from a dedicated endpoint gets all three, and it also gives us one single
choke point (the /play GET below) at which the untrusted document can be
sandboxed with response headers - something the frontend could not do for markup
it received as a JSON string.

TRUST MODEL - READ BEFORE CHANGING ANYTHING HERE
------------------------------------------------
GeneratedGame.html_source is UNTRUSTED. It is a full HTML document with inline
JavaScript that a language model wrote, grounded in course material that was
itself uploaded by users. It is treated exactly like user-submitted HTML would
be. Two consequences run through this module:
  1. The document is served under a hard Content-Security-Policy (see get_game_html,
     where every directive is justified individually).

     WHERE THAT CSP DOES AND DOES NOT APPLY. The header only binds when a browser
     loads THIS RESPONSE as a document. The frontend never does that: it fetches the
     markup as text and mounts it with <iframe srcDoc>, and a response header cannot
     survive that trip. So the CSP is the defence for anyone hitting this endpoint
     directly (curl, a pasted URL, a future server-rendered path) - NOT for normal
     playback. Normal playback is protected by the frame's own
     sandbox="allow-scripts", deliberately without allow-same-origin, which gives the
     page an opaque origin so it cannot reach the app's localStorage token, cookies
     or DOM. Both layers are needed; neither replaces the other.

     A blob: URL is NOT an acceptable substitute for the sandboxed frame: a blob URL
     inherits the origin of the document that created it, so the generated page would
     run same-origin with the app and could read the auth token. The frontend had to
     be changed to stop doing exactly that.
  2. Anything that document *tells us* is input from an attacker's keyboard. The
     score it reports on completion is validated and clamped in record_game_play
     rather than trusted, because a page that can run JavaScript can trivially
     claim a 100 - or a NaN, or a 10^9.

Error-handling style, the course-lookup helper and the mastery/points wiring
mirror app/content_generation/routes.py, which is the precedent for "a student
activity produced a score, feed it to the rest of the system".
"""
import logging
import math
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core import quota
from app.database.connection import get_db
from app.database.models import Course, GeneratedGame, GamePlay, User
from app.gamification import game_service
from app.auth.routes import get_current_user
from app.courses.access import assert_course_access
from app.knowledge_graph.services import neo4j_service
from app.rag.retrieval import retrieve_for_concept, format_excerpts
from app.mastery import service as mastery_service
from app.gamification import service as gamification_service

logger = logging.getLogger("conceptintel.gamification.games")

router = APIRouter(prefix="/games", tags=["Gamification Games"])


class GenerateGameRequest(BaseModel):
    """The client sends only the concept's node id - never its name or description.
    Those are read back out of Neo4j server-side so a caller cannot steer the
    generation toward a concept the course does not actually contain."""
    concept_node_id: str
    difficulty: Optional[str] = None  # "Easy" | "Medium" | "Hard"; defaults to the concept's own


class GeneratedGameOut(BaseModel):
    """Deliberately excludes html_source. Listings and detail views are rendered in
    the React app, which has no use for a 40KB document; the markup is fetched once,
    from the one endpoint that applies the sandboxing headers."""
    id: int
    course_id: int
    concept_node_id: str
    concept_name: str
    title: str
    game_kind: Optional[str] = None
    difficulty: str
    created_by_student_id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class RecordGamePlayRequest(BaseModel):
    """score arrives from the game page's own postMessage, i.e. from LLM-authored
    JavaScript. Typed loosely as a float on purpose - see record_game_play for why
    it is clamped rather than rejected."""
    score: float = Field(..., description="0-100, self-reported by the game page; clamped server-side.")


class GamePlayOut(BaseModel):
    id: int
    game_id: int
    score: float
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


def _get_course_or_404(db: Session, course_id: int) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _get_game_with_access(db: Session, game_id: int, user: User) -> GeneratedGame:
    """Loads a game and proves the caller may see it. Access is scoped to the game's
    COURSE, not to whoever generated it - a game a classmate made is course material
    like any other, and gating it per-creator would make the feature single-player."""
    game = db.query(GeneratedGame).filter(GeneratedGame.id == game_id).first()
    if not game:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found")
    course = _get_course_or_404(db, game.course_id)
    assert_course_access(db, course, user)
    return game


def _lookup_concept_node(catalog_id: int, concept_node_id: str) -> dict:
    """Resolves the concept from the graph rather than trusting client-supplied text -
    same approach as content_generation.routes._lookup_concept_node."""
    graph = neo4j_service.get_catalog_graph(catalog_id)
    node = next((n for n in graph.get("nodes", []) if n.get("id") == concept_node_id), None)
    if not node:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Concept not found in this course's concept graph.",
        )
    return node


# NOTE ON ROUTE ORDER: the /course/... routes are declared BEFORE the /{game_id}
# ones. FastAPI matches in declaration order, so with the reverse order a request
# for /games/course/3 would bind "course" to the int game_id path param and 422
# before ever reaching the intended handler.


@router.post(
    "/course/{course_id}/generate",
    response_model=GeneratedGameOut,
    status_code=status.HTTP_201_CREATED,
)
def generate_game(
    course_id: int,
    payload: GenerateGameRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Authors a new playable game for one concept and stores it.

    Open to anyone with access to the course - students AND teachers. There is no
    review gate in front of a game, which is a deliberate asymmetry with
    GeneratedContent: generated *assessment* material shapes a grade and must be
    approved, whereas a game only shapes the player's own practice, and forcing a
    teacher round-trip would make the feature unusable at the moment someone
    actually wants it.

    Teachers generate games for two real reasons: to try one before pointing a class
    at it, and to build a set of games for a concept their students are struggling
    with. Games a teacher makes are visible to that course exactly like any other -
    the creator is recorded, not used as a filter.
    """
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)
    if not course.catalog_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This course has no catalog entry / concept graph yet.",
        )
    quota.check_and_increment(db, current_user.id)
    db.commit()

    node = _lookup_concept_node(course.catalog_id, payload.concept_node_id)
    concept_name = node.get("name") or "this concept"
    description = node.get("description") or ""
    # Falls back to the concept's own graph difficulty when the client didn't pick
    # one, so "generate" with no options still produces something pitched sensibly.
    difficulty = game_service.normalize_difficulty(payload.difficulty or node.get("difficulty"))

    # Ground the game in the course's own material so it drills what was actually
    # taught. Best-effort exactly as in content_generation.routes.generate_content: a
    # course with nothing uploaded yet, or a briefly unavailable embedding backend,
    # should still yield a game from the concept description rather than a 5xx.
    excerpts = ""
    try:
        hits = retrieve_for_concept(db, course_id, concept_name, description)
        excerpts = format_excerpts(hits)
    except Exception as e:
        logger.warning(
            "Retrieval failed for concept '%s' in course %d, generating ungrounded game: %s",
            concept_name, course_id, str(e),
        )

    try:
        result = game_service.generate_concept_game(
            concept_name, description, difficulty=difficulty, rag_context=excerpts,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))

    game = GeneratedGame(
        course_id=course_id,
        catalog_id=course.catalog_id,
        concept_node_id=payload.concept_node_id,
        concept_name=concept_name,
        title=result["title"],
        game_kind=result["game_kind"],
        difficulty=difficulty,
        html_source=result["html"],
        created_by_student_id=current_user.id,
    )
    db.add(game)
    db.commit()
    db.refresh(game)
    return GeneratedGameOut.model_validate(game)


@router.get("/course/{course_id}", response_model=list[GeneratedGameOut])
def list_course_games(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every game generated for this course, newest first - shared across the class
    so one student's generation becomes a resource for all of them (and so the
    teacher can see what is being produced under their course)."""
    course = _get_course_or_404(db, course_id)
    assert_course_access(db, course, current_user)

    games = (
        db.query(GeneratedGame)
        .filter(GeneratedGame.course_id == course_id)
        .order_by(GeneratedGame.created_at.desc())
        .all()
    )
    return [GeneratedGameOut.model_validate(g) for g in games]


@router.get("/{game_id}", response_model=GeneratedGameOut)
def get_game(
    game_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Metadata only. The markup lives behind /{game_id}/play."""
    game = _get_game_with_access(db, game_id, current_user)
    return GeneratedGameOut.model_validate(game)


@router.get("/{game_id}/play", response_class=HTMLResponse)
def get_game_html(
    game_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Serves the raw LLM-authored document.

    This is the security-sensitive endpoint of the feature: everything it returns is
    untrusted markup with untrusted inline JavaScript. The response headers below are
    what make serving it acceptable at all.

    Because the endpoint is authenticated with the usual bearer dependency, the
    frontend fetches it with the Authorization header and hands the returned markup to
    a sandboxed iframe/new tab rather than pointing the browser straight at the URL;
    the headers are still set on every response so a direct navigation (a developer, a
    curious student, a copied link) is sandboxed identically.

    CONTENT-SECURITY-POLICY, DIRECTIVE BY DIRECTIVE
    -----------------------------------------------
    default-src 'none'
        The backstop. Everything not explicitly re-allowed below is denied: fetch,
        XHR, WebSocket, workers, frames, media, fonts, manifests. This is what
        guarantees the page cannot phone home - it cannot exfiltrate the student's
        session, the course material it was grounded in, or anything it can read from
        its own DOM, because it has no permitted network destination at all.
    style-src 'unsafe-inline'
        The game's CSS is inlined in a <style> block, which is exactly what
        'unsafe-inline' permits. It is safe *here* in a way it is not in a normal app:
        inline CSS is only dangerous as a vehicle for exfiltration or clickjacking of
        surrounding content, and this document has no surrounding content and no
        network egress. No external stylesheet host is listed, so a CDN font or theme
        still fails.
    script-src 'unsafe-inline'
        The whole point of the feature - the game logic is an inline <script>. Note
        what is NOT here: no host source, so <script src="https://cdn..."> is blocked;
        and because a source list is present, this is a strict allowlist rather than
        an open door. The script runs with no network access, in a document served
        from an endpoint that returns nothing but this one page.
    img-src data:
        Lets the model draw with inline data: URIs (and inline SVG) while blocking
        every remote image. Remote images are the classic CSP-bypass exfiltration
        channel - encode a secret in a URL, request the image, read the server log -
        so allowing only data: closes that path while keeping the page able to have
        graphics.
    base-uri 'none'
        Blocks an injected <base href="..."> from silently re-pointing every relative
        URL in the document at an attacker's origin.
    form-action 'none'
        The page has no legitimate reason to submit a form anywhere. Without this, a
        form POST would be an egress channel that the fetch/XHR restrictions above do
        not cover.
    frame-ancestors 'self'
        Only our own origin may embed this page. Stops a third-party site from
        framing the authenticated game endpoint to clickjack it or to observe the
        student's session.

    X-Content-Type-Options: nosniff
        Forces the browser to honour text/html rather than re-sniffing the body into
        some other, more permissive type.
    Referrer-Policy: no-referrer
        Nothing about the game's URL - which carries its database id - should ever
        leak outward in a Referer header.
    """
    game = _get_game_with_access(db, game_id, current_user)

    csp = (
        "default-src 'none'; "
        "style-src 'unsafe-inline'; "
        "script-src 'unsafe-inline'; "
        "img-src data:; "
        "base-uri 'none'; "
        "form-action 'none'; "
        "frame-ancestors 'self'"
    )
    return HTMLResponse(
        content=game.html_source,
        headers={
            "Content-Security-Policy": csp,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    )


@router.post("/{game_id}/play", response_model=GamePlayOut, status_code=status.HTTP_201_CREATED)
def record_game_play(
    game_id: int,
    payload: RecordGamePlayRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Records a completed play and feeds the score into mastery and points exactly
    as content_generation.routes.submit_quiz_attempt does for a quiz - so playing a
    game is real evidence for the Adaptive Engine and the leaderboard, not a
    cosmetic side activity.

    Student-only: this is the same "solve" surface as a mock test, a study drill or
    an exam, and ConceptMastery/StudentPoints are per-student tables keyed on a
    student id anyway - a teacher's id in them would invent a phantom learner who
    appears on their own course's leaderboard and skews every weak-concept
    calculation the Adaptive Engine makes. A teacher may still GENERATE a game (see
    generate_game above) to try it before pointing a class at it - that's an
    authoring action - but recording a *play* of one is not.

    WHY THE SCORE IS CLAMPED AND NOT REJECTED
    -----------------------------------------
    The number originates in the game page's own postMessage, i.e. in JavaScript a
    language model wrote. It is untrusted in the strict sense - nothing stops it
    being 10**9, -5, or NaN. Two options were considered:
      - 422 anything outside 0-100. Rejected: the offender is a buggy generated page,
        but the person who eats the error is the student who just finished playing it,
        and their play is lost.
      - Coerce into range. Chosen: a non-finite score is refused outright (there is no
        sane value to coerce NaN to and it would poison the mastery average), while a
        merely out-of-range number is pulled back to the nearest valid bound. The
        student's play is still recorded and the mastery table can never be corrupted.

    This bounds *malfunction*, not *cheating*: a student who opens devtools can post a
    100 here regardless. That is accepted. The authoritative assessment signals in this
    system are assignments and quizzes; a game is practice, and its worst case is a
    student inflating their own practice record.
    """
    game = _get_game_with_access(db, game_id, current_user)
    if current_user.role.lower() != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Concept games are for students to play - only a student's play is recorded.",
        )

    raw_score = float(payload.score)
    if not math.isfinite(raw_score):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The game reported an invalid score.",
        )
    score = round(max(0.0, min(100.0, raw_score)), 1)
    if score != round(raw_score, 1):
        logger.warning(
            "Game %d reported an out-of-range score %r for user %d; clamped to %s.",
            game_id, raw_score, current_user.id, score,
        )

    play = GamePlay(
        game_id=game.id,
        student_id=current_user.id,
        course_id=game.course_id,
        score=score,
    )
    db.add(play)

    mastery_service.record_evidence(
        db, current_user.id, game.course_id, game.catalog_id,
        game.concept_node_id, game.concept_name, score,
        source_type="game", source_id=game.id,
    )
    gamification_service.award_points(
        db, current_user.id, game.course_id, round(score / 10),
        reason=f"Played game: {game.title}", source_type="game", source_id=game.id,
    )

    db.commit()
    db.refresh(play)
    return GamePlayOut.model_validate(play)
