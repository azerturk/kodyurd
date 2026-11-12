Operations runbook
==================

Harbor Desk runs as one Node.js process. `server.mjs <../server.mjs>`_ opens the
database, starts the HTTP server and then starts the
`notification worker <../notifications/worker.mjs>`_.

Process lifecycle
-----------------

.. mermaid::

   sequenceDiagram
       participant Entry as server.mjs
       participant Store as SQLite store
       participant App as HTTP server
       participant Worker as Notification worker
       Entry->>Store: Open the database file
       Entry->>App: Create the app with the store
       Entry->>App: Listen on 127.0.0.1 and PORT
       App-->>Entry: Listening
       Entry->>Worker: Start ticking every 250 ms
       Entry->>App: Close on SIGINT or SIGTERM
       App-->>Entry: Closed
       Entry->>Worker: Stop the timer
       Entry->>Store: Close the database

The worker starts only after the server is listening. The database closes only
after the worker has stopped.

Settings
--------

+----------------------------------+-------------------------+--------------------------------------------------+
| Variable                         | Default                 | Effect                                           |
+==================================+=========================+==================================================+
| ``PORT``                         | ``4724``                | Loopback port. An integer from 1 to 65535.       |
+----------------------------------+-------------------------+--------------------------------------------------+
| ``HARBOR_DB``                    | ``.data/harbor.sqlite`` | Database file. Its folder is created at startup. |
+----------------------------------+-------------------------+--------------------------------------------------+
| ``HARBOR_DEMO_NOTIFY_FAIL_ONCE`` | unset                   | ``1`` makes each message's first delivery fail.  |
+----------------------------------+-------------------------+--------------------------------------------------+

Retry timing
------------

A failed delivery is retried with a doubling delay::

   attempt 1 fails -> retry after 1 second
   attempt 2 fails -> retry after 2 seconds
   attempt 3 fails -> marked failed

The same schedule on a clock, when every attempt fails:

.. mermaid::

   timeline
       title Delivery attempts when every attempt fails
       0 s : Attempt 1 fails : Retry due 1 second later
       1 s : Attempt 2 fails : Retry due 2 seconds later
       3 s : Attempt 3 fails : Marked failed

Start an isolated demonstration
-------------------------------

#. Set ``HARBOR_DB`` to a new local file path.
#. Run ``npm start`` and open the printed address.
#. Book a resource as Alice, then refresh activity to see the mailbox message.
#. Press Ctrl+C. The worker stops and the database closes.
