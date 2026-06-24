#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Add a Discover tab at the bottom center that contains a scrollable feed of widgets:
  AI stock recommendations, Market-moving events, Hot analyst ratings, Popular screeners,
  Undervalued/Overvalued, Top investor picks, Most active, Daily winners & losers.
  Each widget must open a detail screen with inner tabs and tables for depth.

backend:
  - task: "Discover widgets backend (discover_service.py + endpoints)"
    implemented: true
    working: true
    file: "backend/discover_service.py, backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: |
            Added discover_service.py with multi-factor AI scoring (momentum/value/quality/growth/technical),
            synthesized analyst rating distribution & price targets, market event detection (breakouts,
            sell-offs, RSI extremes, volume surges, golden cross), undervalued/overvalued (sector-relative
            P/E), investor style portfolios (Buffett/Lynch/Graham/Growth/Dividend), most-active by volume
            surge, winners/losers. Endpoints: /api/discover/feed (combined), /api/discover/ai-picks,
            /events, /analyst-ratings, /popular-screeners, /valuation, /investor-picks, /most-active,
            /winners-losers. Verified manually via curl — all return rich data.

frontend:
  - task: "Discover tab at bottom center + scrollable widget feed"
    implemented: true
    working: true
    file: "frontend/app/(tabs)/_layout.tsx, frontend/app/(tabs)/discover.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: |
            Inserted 'Discover' tab at center position (Markets / Radar / Discover / Screener / Watchlist)
            with sparkles icon. Discover feed renders 8 widget preview cards: AI Picks, Events,
            Analyst Ratings, Popular Screeners, Valuation (under/over), Investor Picks, Most Active,
            Winners/Losers. Verified visually — feed shows live INCY 81.4 STRONG BUY, 52-week
            breakouts, analyst rating bars, etc.

  - task: "Discover detail screens with inner tabs + tables"
    implemented: true
    working: true
    file: "frontend/app/discover/[id].tsx, frontend/src/components/widgets/*"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: |
            Dynamic detail route /discover/[id] handles all 8 widgets. Includes:
            - SegmentedTabs component for inner navigation (Buy/Hold/Sell, Upgrades/Downgrades, etc.)
            - DataTable component (horizontally scrollable, alternating rows, column-tone coloring)
            - RatingBar component (stacked analyst-distribution viz)
            - ScoreBar component (factor breakdown)
            - Spotlight card for top AI pick with score breakdown + reason chips
            - Stat strip showing universe-wide aggregates
            Verified visually: AI Picks detail shows spotlight (INCY) + factor bars + 20-row table
            with SYMBOL/SCORE/RATING/PRICE/%/PE/ROE columns. Tabs switching works.

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 0
  run_ui: false

test_plan:
  current_focus:
    - "Discover widgets backend (discover_service.py + endpoints)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: |
        ## v1.2 — Major upgrade: real analyst data, sortable tables, deep analyzer
        Backend:
        - Extended Yahoo Finance quoteSummary modules to include recommendationTrend, upgradeDowngradeHistory,
          calendarEvents, earningsHistory, earningsTrend, institutionOwnership, insiderHolders.
        - _fetch_summary_layer now extracts: real target_mean/high/low/median, recommendation_mean,
          analyst_count, rating_distribution (real percentages), latest_upgrade_downgrade,
          next_earnings_epoch, ex_dividend_epoch, dividend_date_epoch, latest_eps_surprise_pct,
          eps_growth_next_year_pct, pct_institutions, pct_insiders, top_institution, description, employees.
        - analyzer_service.py: forecast_horizons (real 1Y consensus + AI 1M/3M/6M),
          earnings_calendar, dividend_calendar, sector_rotation, institutional_activity,
          analyzer(symbol) — comprehensive deep analysis with verdict/scores/forecasts/financials/risk/catalysts/trade idea.
        - discover_service.analyst_ratings now prefers REAL targets/ratings from Yahoo.
        - _detect_events expanded: earnings calendar, dividend, analyst upgrade/downgrade, EPS surprise.
        - Crumb auto-refresh on 401 to harden Yahoo session.

        Endpoints added:
          /api/discover/forecast, /api/discover/earnings-calendar, /api/discover/dividend-calendar,
          /api/discover/sector-rotation, /api/discover/institutional-activity, /api/analyzer/{symbol}

        Frontend:
        - SortableDataTable component (sortable headers + frozen sticky-left ticker column).
        - AI Picks detail upgraded with 15 comprehensive columns and sortable headers.
        - 4 new widget cards on Discover feed: Forecast Horizons, Earnings Calendar,
          Dividend Calendar, Sector Rotation — each opens a full sortable detail.
        - AI Analyzer screen at /analyzer/[symbol] — verdict hero, factor breakdown,
          Wall Street consensus with real rating distribution + price target range,
          forecast horizons cards, pros/cons, trade idea, full financials/technicals/risk/catalysts/ownership/about.
        - "AI Analyzer" sparkles button added to top-right of every stock detail page.

        All data verified live: AAPL → 42 analysts, $314.42 target, KGI Securities downgrade real.
        PLTR forecast 62% upside (real analyst consensus).

    - agent: "main"
      message: |
        Built Discover feature end-to-end. Backend has 9 new endpoints under /api/discover/*.
        Frontend has new bottom-center tab with scrollable feed + dynamic detail screens with
        inner tabs and tables. Reused existing cached universe so no new external API calls
        required. AI scoring is transparent multi-factor heuristic (no LLM cost).