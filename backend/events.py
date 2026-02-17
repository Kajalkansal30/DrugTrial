from typing import Callable, List, Dict, Any
import logging
import asyncio

logger = logging.getLogger(__name__)

class EventBus:
    def __init__(self):
        self._subscribers: Dict[str, List[Callable]] = {}

    def subscribe(self, event_type: str, handler: Callable):
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(handler)
        logger.info(f"Subscribed {handler.__name__} to {event_type}")

    async def publish(self, event_type: str, data: Any):
        """
        Publish an event to all subscribers.
        Handlers are executed asynchronously.
        """
        logger.info(f"Publishing event {event_type}")
        if event_type in self._subscribers:
            tasks = []
            for handler in self._subscribers[event_type]:
                # Create a task for each handler to run them concurrently
                # and ensure one failing handler doesn't block others
                tasks.append(self._run_handler(handler, data, event_type))
            
            # We don't wait for them here if we want fire-and-forget from the publisher's perspective
            # But usually we want to await them if we are already in an async context?
            # Creating tasks schedules them on the event loop.
            # If the caller awaits publish(), we should probably await all tasks.
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _run_handler(self, handler, data, event_type):
        try:
            if asyncio.iscoroutinefunction(handler):
                await handler(data)
            else:
                handler(data)
        except Exception as e:
            logger.error(f"Error in handler {handler.__name__} for event {event_type}: {e}")
            import traceback
            logger.error(traceback.format_exc())

# Global instance
event_bus = EventBus()
